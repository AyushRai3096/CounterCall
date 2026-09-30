# CounterCall

Local-first order relay system for a restaurant: a mobile order-entry
PWA, a relay server, and a counter-side print service.

## Architecture (current deployment decision)

**The relay server and the counter app run on the same Windows PC**
— the counter PC. Nothing is hosted anywhere else. The counter PC is
made reachable from the internet over HTTPS with a free, permanent
**Tailscale Funnel** address, so phones (Android only) don't need to be
on the restaurant WiFi, and nobody ever needs to know an IP address.

```
[Android phones] --HTTPS--> https://<pc>.<tailnet>.ts.net  (Tailscale Funnel)
   mobile-pwa                          |
   (installed from that URL,           v
    runs on the phone)          [Counter PC]
                                 ├─ relay-server (localhost:4000; serves the
                                 |                PWA files AND the socket)
                                 └─ counter-app  (Electron, packaged/installed
                                       separately; connects to localhost:4000,
                                       prints via Electron's native print
                                       pipeline, printer picked from its tray
                                       icon)
```

`counter-app` replaced `counter-service` (an earlier Node + Edge-headless +
SumatraPDF pipeline) after repeated, hard-to-diagnose failures on the real
counter PC. `counter-service`'s code is gone from the working tree (still in
git history) but its lessons — the durability model, retry rules, KOT
template — carried over unchanged. See `CLAUDE.md` for the full history.

- The relay also **serves the PWA files itself**, so the one Funnel
  address is both the app's download location and the relay. On each
  phone open that address in Chrome once and choose Install. Because it's
  HTTPS, that's a real PWA install with an offline copy. The PWA finds
  the relay automatically
  ([mobile-pwa/public/config.js](mobile-pwa/public/config.js) uses the
  page's own origin — nothing to configure).
- `counter-app` connects to the relay over **localhost** (same machine) —
  `RELAY_URL=http://localhost:4000` in its own `.env` (in its Windows
  userData folder, not this repo — set via its tray icon, not by hand),
  which is also the default.
- This **requires internet at the restaurant** (phone → internet →
  counter PC). If it drops, orders don't get through and the PWA's
  15-second "not confirmed — call manager" warning fires.
- The relay is therefore publicly reachable and has no login (see
  "Security" below).

### One-time setup on the counter PC

**Relay server + Tailscale:**

1. Download or `git clone` this project **into its permanent folder**
   (e.g. `C:\CounterCall`) — not a temporary Downloads location, and make
   sure `relay-server\node_modules` came with it (it's committed to this
   repo on purpose — see below).
2. Right-click [install.bat](install.bat) and choose **Run as
   administrator**.

It installs Node.js and Tailscale if missing (`npm install` is **not**
run for relay-server — the dependencies are already there), creates a
shortcut in the Windows **Startup folder** so relay-server launches, with
no visible window, the moment you sign in, and a **Start CounterCall**
desktop icon as a manual backup. It then signs Tailscale in (unattended
mode) and publishes the relay with `tailscale funnel --bg 4000`, printing
the permanent `https://<pc>.<tailnet>.ts.net` address at the end. Two
interactive steps it can't skip: signing in to Tailscale, and (first time
only) opening the link Tailscale shows to allow Funnel, then running the
script again. Then on each Android phone open that address in Chrome and
tap Install.

**Counter app (printing):** separately, copy `CounterCall Counter App
Setup.exe` to the counter PC directly (USB, network share — **not**
through git; Electron's own runtime is too large for GitHub's 100MB
per-file limit) and run it. It installs itself, launches, and registers
its own auto-start (a registry Run key, not the Startup-folder mechanism
above). Right-click its tray icon to pick the printer from the installed
Windows printers — that choice is remembered from then on.

**Why `relay-server/node_modules` is committed to this repo:** on the
actual counter PC, `npm install` repeatedly failed — PowerShell's script
execution policy blocked it, then a past dependency's native build step
failed with a `node-gyp`/Python error because it couldn't download a
prebuilt Windows binary. Shipping the already-built `node_modules` (built
and tested here) means the counter PC never needs Node-native
compilation, Python, Visual Studio, or a working path to npm's registry
— it only needs Node.js itself to run the already-resolved code.
`counter-app`'s dependencies (including Electron, ~180MB+) are **not**
committed the same way for exactly the reason above — it's built into a
packaged installer instead (see `CLAUDE.md`).

(Tailscale commands and options are per its current docs and could not be
run or verified from this repo; if something differs, follow Tailscale's
documentation.)

### Security

Anyone who learns the Funnel address can open the app and submit orders
(which print tickets); there is no authentication yet. The address isn't
guessable, but it isn't secret either. Adding a shared access code is a
sensible next step if that matters.

## Running everything on the counter PC

Nothing is started by hand day to day, but the two services now use two
**different** auto-start mechanisms:

- **relay-server**: `install.bat` puts a shortcut to
  [run-all-hidden.vbs](run-all-hidden.vbs) in the current user's Windows
  **Startup folder**, so it launches — with no console window — the
  moment that user signs in, and restarts itself if it crashes
  (`relay-server/run.bat` is the restart loop; `run-hidden.vbs` launches
  it invisibly). This deliberately does **not** use Task Scheduler or the
  SYSTEM account (that approach hit repeated, hard-to-diagnose failures
  on the real counter PC).
- **counter-app**: registers its own auto-start (a registry Run key, via
  Electron's `setLoginItemSettings`) the first time it's launched after
  installing. No VBS, no Startup folder involved for this one.

Both just need someone to sign in, same as opening the till for the day.

**Backup:** `start-services.bat`, in the project's root folder, starts
relay-server if it isn't already running and reports both services'
status. `install.bat` also puts a **Start CounterCall** icon on the
desktop that runs this same file — but if some PCs block creating new
desktop icons, that's fine, just run `start-services.bat` directly from
the project folder instead. If counter-app shows as not running, launch
"CounterCall Counter App" from the Start Menu. The `.ts.net` address is
printed at the end of the install window and any time by `tailscale funnel
status`; it doesn't change on reboot (only if the PC or tailnet is renamed).

For a manual/dev run of relay-server instead of the Startup-folder launch,
see [relay-server/README.md](relay-server/README.md). For counter-app,
`cd counter-app && npm start` runs it unpackaged; `npm run dist` builds
the installer — see `CLAUDE.md`.

## Components

- [mobile-pwa/](mobile-pwa/README.md) — order entry PWA (phones, installed to home screen)
- [relay-server/](relay-server/README.md) — bridges the PWA and the counter app, no database
- `counter-app/` — Electron app: durable SQLite queue + KOT ticket printing (Windows printer, native Electron print pipeline), printer picked from its tray icon. Packaged into an installer for distribution — see `CLAUDE.md`.

## Production checklist

- counter-app's tray icon shows the correct printer selected (picked
  once, remembered after).
- `mobile-pwa/public/menu.json`: real menu items (item field also
  accepts free-typed names not in the list — it never blocks).
- `install.bat` run once as Administrator for relay-server + Tailscale,
  `CounterCall Counter App Setup.exe` run once for the printer service,
  then sign out and back in to confirm both auto-start: the tray icon
  reappears and a phone order prints.
