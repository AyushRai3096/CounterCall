# CounterCall

Local-first order relay system for a restaurant: a mobile order-entry
PWA, a relay server, and a counter-side print service.

## Architecture (current deployment decision)

**The relay server and the counter service run on the same Windows PC**
— the counter PC. Nothing is hosted anywhere else. The counter PC is
made reachable from the internet over HTTPS with a free, permanent
**Tailscale Funnel** address, so phones (Android only) don't need to be
on the restaurant WiFi, and nobody ever needs to know an IP address.

```
[Android phones] --HTTPS--> https://<pc>.<tailnet>.ts.net  (Tailscale Funnel)
   mobile-pwa                          |
   (installed from that URL,           v
    runs on the phone)          [Counter PC]
                                 ├─ relay-server    (localhost:4000; serves the
                                 |                   PWA files AND the socket)
                                 └─ counter-service (connects to
                                       localhost:4000, drives the printer or,
                                       in dev mode, a browser preview on :4100)
```

- The relay also **serves the PWA files itself**, so the one Funnel
  address is both the app's download location and the relay. On each
  phone open that address in Chrome once and choose Install. Because it's
  HTTPS, that's a real PWA install with an offline copy. The PWA finds
  the relay automatically
  ([mobile-pwa/public/config.js](mobile-pwa/public/config.js) uses the
  page's own origin — nothing to configure).
- The counter service connects to the relay over **localhost** (same
  machine) — `counter-service/.env` `RELAY_URL=http://localhost:4000`,
  which is also the default.
- This **requires internet at the restaurant** (phone → internet →
  counter PC). If it drops, orders don't get through and the PWA's
  15-second "not confirmed — call manager" warning fires.
- The relay is therefore publicly reachable and has no login (see
  "Security" below).

### One-time setup on the counter PC

1. Download or `git clone` this project **into its permanent folder**
   (e.g. `C:\CounterCall`) — not a temporary Downloads location, and make
   sure `relay-server\node_modules` and `counter-service\node_modules`
   came with it (they're committed to this repo on purpose — see below).
2. Right-click [install.bat](install.bat) and choose **Run as
   administrator**.

It installs Node.js, SumatraPDF and Tailscale if missing (`npm install`
is **not** run — the dependencies are already there), asks for the
printer name (writes `counter-service/.env`), creates a shortcut in the
Windows **Startup folder** so both services launch, with no visible
window, the moment you sign in, and a **Start CounterCall** desktop icon
as a manual backup. It then signs Tailscale in (unattended mode) and
publishes the relay with `tailscale funnel --bg 4000`, printing the
permanent `https://<pc>.<tailnet>.ts.net` address at the end. Two
interactive steps it can't skip: signing in to Tailscale, and (first time
only) opening the link Tailscale shows to allow Funnel, then running the
script again. Then on each Android phone open that address in Chrome and
tap Install.

**Why `node_modules` is committed to this repo:** on the actual counter
PC, `npm install` repeatedly failed — PowerShell's script execution
policy blocked it, then `better-sqlite3`'s native build step failed with
a `node-gyp`/Python error because it couldn't download a prebuilt
Windows binary. Shipping the already-built `node_modules` (built and
tested here, prebuilt native binary included) means the counter PC never
needs Node-native compilation, Python, Visual Studio, or a working path
to npm's registry for that package — it only needs Node.js itself to run
the already-resolved code.

(Tailscale commands and options are per its current docs and could not be
run or verified from this repo; if something differs, follow Tailscale's
documentation.)

### Security

Anyone who learns the Funnel address can open the app and submit orders
(which print tickets); there is no authentication yet. The address isn't
guessable, but it isn't secret either. Adding a shared access code is a
sensible next step if that matters.

## Running everything on the counter PC

Nothing is started by hand day to day: `install.bat` (above) puts a
shortcut to [run-all-hidden.vbs](run-all-hidden.vbs) in the current
user's Windows **Startup folder**, so both services launch — with no
console window — the moment that user signs in, and each restarts itself
if it crashes (`relay-server/run.bat`, `counter-service/run.bat` are the
restart loops; the `run-hidden.vbs` in each folder launches one of them
invisibly). This deliberately does **not** use Task Scheduler or the
SYSTEM account (that approach hit repeated, hard-to-diagnose failures on
the real counter PC) — it just needs someone to sign in, same as opening
the till for the day.

**Backup:** `start-services.bat`, in the project's root folder, starts
whichever of the two isn't already running and reports the status of both.
Use it if they didn't start automatically. `install.bat` also puts a
**Start CounterCall** icon on the desktop that runs this same file — but if
some PCs block creating new desktop icons, that's fine, just run
`start-services.bat` directly from the project folder instead; nothing
about what it does depends on the icon existing. It checks before starting
each one — **never run a second copy of counter-service**, it causes
orders to silently go missing (see `CLAUDE.md`). The `.ts.net` address is
printed at the end of the install window and any time by `tailscale funnel
status`; it doesn't change on reboot (only if the PC or tailnet is renamed).

For manual/dev runs instead of the Startup-folder launch, each folder has
its own `npm start` — see that component's README.

## Components

- [mobile-pwa/](mobile-pwa/README.md) — order entry PWA (phones, installed to home screen)
- [relay-server/](relay-server/README.md) — bridges the PWA and the counter service, no database
- [counter-service/](counter-service/README.md) — durable SQLite queue + KOT ticket printing (Windows printer), or a browser preview in dev mode

## Production checklist

- `counter-service/.env`: `DEV_MODE` unset or `false` (defaults to real
  printer — see that README for why this default matters), correct
  `PRINTER_NAME` (SumatraPDF installed; Edge ships with Windows).
- `mobile-pwa/public/menu.json`: real menu items (item field also
  accepts free-typed names not in the list — it never blocks).
- `install.bat` run once as Administrator, then sign out and back in to
  confirm auto-start: the counter-service log shows a fresh "Counter
  service starting" line and a phone order prints.
