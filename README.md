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

Right-click [setup-counter-pc.bat](setup-counter-pc.bat) and choose **Run
as administrator**. It installs Node.js and Tailscale if missing, runs
`npm install`, asks for the printer type/address (writes
`counter-service/.env`), registers both services to start at every
Windows boot (before anyone signs in, restart on crash), sets sleep to
Never, signs Tailscale in (unattended mode) and publishes the relay with
`tailscale funnel --bg 4000`. It prints the permanent
`https://<pc>.<tailnet>.ts.net` address at the end. Two interactive
steps it can't skip: signing in to Tailscale, and (first time only) opening
the link Tailscale shows to allow Funnel, then running the script again.
Then on each Android phone open that address in Chrome and tap Install.

(Tailscale commands and options are per its current docs and could not be
run or verified from this repo; if something differs, follow Tailscale's
documentation.)

### Security

Anyone who learns the Funnel address can open the app and submit orders
(which print tickets); there is no authentication yet. The address isn't
guessable, but it isn't secret either. Adding a shared access code is a
sensible next step if that matters.

## Running everything on the counter PC

Nothing is started by hand: `setup-counter-pc.bat` (above) registers the
relay and counter service as boot-time Task Scheduler tasks running as
SYSTEM, so they start before anyone signs in with no auto-login or stored
password, and each restarts itself if it crashes. Tailscale runs as a
Windows service and its Funnel setting persists.

**Backup:** the setup also puts a **Start CounterCall** icon on the desktop
(`start-services.bat`). If the services ever aren't running after a boot,
click it: it asks for administrator permission, starts both, and shows
whether the relay is answering. It's safe to click when they're already
running (Task Scheduler won't start a second copy). The `.ts.net` address
is printed at the end of the setup window and any time by
`tailscale funnel status`; it doesn't change on reboot (only if the PC or
tailnet is renamed).

For manual/dev runs instead of the scheduled tasks, each folder has its
own `npm start` — see that component's README.

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
- `setup-counter-pc.bat` run once as Administrator, then a reboot test (without signing in): the counter-service log shows a fresh "Counter service starting" line and a phone order prints.
