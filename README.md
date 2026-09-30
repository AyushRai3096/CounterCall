# CounterCall

Local-first order relay system for a restaurant: a mobile order-entry
PWA and a single counter-side app that does everything else.

## Architecture (current deployment decision)

**One installed app on the counter PC does it all** — `counter-app`
(Electron) embeds the relay (phone ↔ counter bridge + PWA static
hosting) and the printer service in the same process. There is no
separate relay-server process to run in production anymore. The counter
PC is made reachable from the internet over HTTPS with a free, permanent
**Tailscale Funnel** address, so phones (Android only) don't need to be
on the restaurant WiFi, and nobody ever needs to know an IP address.

```
[Android phones] --HTTPS--> https://<pc>.<tailnet>.ts.net  (Tailscale Funnel)
   mobile-pwa                          |
   (installed from that URL,           v
    runs on the phone)          [Counter PC]
                                 counter-app (single installed Electron app)
                                 ├─ embedded relay  (:4000 — serves the PWA
                                 |                    files AND the socket)
                                 ├─ printer service (SQLite queue, prints via
                                 |                    Electron's native print)
                                 └─ auto-enables Tailscale Funnel on :4000
                                     at startup (if Tailscale is already
                                     signed in — see setup below)
```

`counter-app` replaced two earlier, separate components:
- `counter-service` (an earlier Node + Edge-headless + SumatraPDF print
  pipeline) — repeated, hard-to-diagnose failures on the real counter PC.
- `relay-server` (a separate always-on Node process) — merged into
  `counter-app` itself so there's exactly **one** thing to install and
  **zero** separate services to remember to start.

Both predecessors' code is gone from the working tree (recoverable from
git history); their logic and lessons carried over into `counter-app`
unchanged. See `CLAUDE.md` for the full history and every hard-won
gotcha along the way.

- The embedded relay **serves the PWA files itself**
  (`counter-app/src/relay/staticServer.js`, from `mobile-pwa/public`,
  bundled into the installer), so the one Funnel address is both the
  app's download location and the relay. On each phone open that
  address in Chrome once and choose Install. Because it's HTTPS, that's
  a real PWA install with an offline copy. The PWA finds the relay
  automatically ([mobile-pwa/public/config.js](mobile-pwa/public/config.js)
  uses the page's own origin — nothing to configure).
- Internally, the printer-service half still talks to the relay half
  over `RELAY_URL=http://localhost:4000` (loopback, same process) — an
  intentional leftover of the two-piece design, kept because it works
  and splitting the protocol out again would be needless risk for no
  benefit.
- This **requires internet at the restaurant** (phone → internet →
  counter PC). If it drops, orders don't get through and the PWA's
  15-second "not confirmed — call manager" warning fires.
- The relay is therefore publicly reachable and has no login (see
  "Security" below).

### One-time setup on the counter PC

1. **Tailscale** — install it (tailscale.com or `winget install -e --id
   Tailscale.Tailscale`) and sign in once (`tailscale up`, or via its
   tray app). This is a real, interactive VPN sign-in — no installer can
   safely automate it. Do this before installing `counter-app`, since it
   auto-enables Funnel on startup only if Tailscale is already signed in
   (if you install `counter-app` first, just restart it after signing
   in to Tailscale — or run `tailscale funnel --bg 4000` yourself once).
2. **`counter-app`** — copy `CounterCall Counter App Setup <version>.exe`
   to the counter PC directly (USB, network share — **not** through git;
   Electron's own runtime is too large for GitHub's 100MB per-file
   limit) and run it. It installs itself, launches, and sets up its own
   auto-start and crash-restart watchdog (see "Running everything on the
   counter PC" below) — nothing else to run. Right-click its tray icon
   to pick the printer from the installed Windows printers; that choice
   is remembered from then on. Check its log
   (`%APPDATA%\counter-app\logs\counter-app.log`) for a `[relay] Relay
   listening on :4000` line and either `[tailscale] Funnel enabled on
   :4000.` or a warning explaining why not.
3. Copy the printed `https://….ts.net` address (from the log, or
   `tailscale funnel status`) — open it in Chrome on each Android phone
   and tap Install.

**Why this isn't `git clone` + `npm install`:** on the actual counter
PC, `npm install` repeatedly failed — PowerShell's script execution
policy blocked it, then a native dependency's build step failed for
lack of a working path to fetch a prebuilt binary. `counter-app`'s
installer is fully self-contained (Electron's runtime, Node, and every
native dependency already built in) specifically so the counter PC
never needs Node.js, `npm`, or any build tooling at all.

(Tailscale commands and options are per its current docs and could not
be run or verified from this repo; if something differs, follow
Tailscale's documentation.)

### Security

Anyone who learns the Funnel address can open the app and submit orders
(which print tickets); there is no authentication yet. The address isn't
guessable, but it isn't secret either. Adding a shared access code is a
sensible next step if that matters.

## Running everything on the counter PC

Nothing is started by hand day to day. `counter-app` sets up its own
resilience on first launch (`src/watchdog.js`):
- Registers a Windows **Startup folder** shortcut, so it launches at
  sign-in — the same mechanism this project has always used (no Task
  Scheduler, no SYSTEM account; that approach hit repeated,
  hard-to-diagnose failures on the real counter PC in an earlier design).
- Also starts a small watchdog loop immediately (not just registered
  for next sign-in), which polls every ~5s and relaunches the app if
  it's not running — a crash, a Windows restart, or clicking the tray's
  **Restart** item all recover within seconds. The only way to actually
  stop it long-term is to uninstall it (Settings → Apps) or delete its
  install folder directly.

The `.ts.net` Funnel address doesn't change across restarts (only if the
PC or tailnet is renamed) — check it any time with `tailscale funnel
status`, or in `counter-app`'s log.

For a manual/dev run instead of the packaged installer: `cd counter-app
&& npm start` runs it unpackaged (needs `.env`/tray-picked printer same
as packaged); `npm run dist` builds the installer — see `CLAUDE.md` for
the full build requirements (Developer Mode, the `better-sqlite3`
Electron-ABI gotcha, etc.).

`relay-server/` and `install.bat`/`start-services.bat`/
`run-all-hidden.vbs` still exist in this repo but are **not part of the
current deployment** — their logic was ported into
`counter-app/src/relay/` and Electron's own mechanisms respectively.
They're kept as a reference/fallback, not because they're still run in
production. Don't reach for them unless you're deliberately reverting
the embedded-relay decision.

## Components

- [mobile-pwa/](mobile-pwa/README.md) — order entry PWA (phones, installed to home screen)
- `counter-app/` — the entire counter PC app: embedded relay (Socket.io bridge + PWA static hosting, `src/relay/`), durable SQLite order queue, KOT ticket printing (Windows printer, native Electron print pipeline, printer picked from its tray icon), and Tailscale Funnel auto-enable. Packaged into a single installer for distribution — see `CLAUDE.md`.
- `relay-server/` — the embedded relay's predecessor as a standalone process. Not used in production anymore (see above); kept for reference.

## Production checklist

- Tailscale installed and signed in on the counter PC (one-time,
  interactive — see setup above).
- `counter-app`'s tray icon shows the correct printer selected (picked
  once, remembered after).
- `mobile-pwa/public/menu.json`: real menu items (item field also
  accepts free-typed names not in the list — it never blocks).
- `counter-app`'s log shows both `[relay] Relay listening on :4000` and
  `[tailscale] Funnel enabled on :4000.` after a fresh sign-in (confirms
  auto-start survived a reboot, not just the initial install), and a
  phone order prints end to end.
