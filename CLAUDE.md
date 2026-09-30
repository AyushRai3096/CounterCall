# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CounterCall: a local-first order relay system for a restaurant.
Independent components, no shared build tooling, no monorepo tool (no
lerna/nx/workspaces) — each folder is its own `npm install`.

- **mobile-pwa/** — order-entry PWA (phones, installed to home screen). Plain HTML/CSS/JS, no framework, no build step.
- **counter-app/** — Electron desktop app, runs on the counter PC. This is now the **entire** counter-side system: it embeds the relay (Socket.io bridge + PWA static hosting, `src/relay/`) in the same process as the printer service, persists orders to SQLite (better-sqlite3) before acking anything, then prints a KOT ticket on a Windows thermal printer via Electron's own native print pipeline. Packaged into an installer for distribution (not run via `npm start`/git-cloned `node_modules` — see "Packaging and distribution" below).

Two earlier, separate components are **gone from the working tree**
(still recoverable from git history) — their logic and lessons carried
over into `counter-app` unchanged; where this file says "the source
app" or references an older Electron design, that's a predecessor's own
predecessor per `KOT_TEMPLATE_SPEC.md`, not either of these — don't
confuse the generations:
- `counter-service/` — the original counter-side process (Node: HTML →
  Edge headless → PDF → SumatraPDF). Replaced by `counter-app` after
  repeated, hard-to-diagnose failures on the real counter PC.
- `relay-server/` — a standalone Node process (Socket.io bridge + PWA
  static hosting). Its code was **ported into** `counter-app/src/relay/`
  (see "Merging relay-server into counter-app" below) so there's exactly
  one thing to install on the counter PC and zero separate services to
  remember to start. `relay-server/` itself still exists in the repo as
  reference/fallback but is **not part of the current deployment** —
  don't add features there expecting them to reach production; add them
  to `counter-app/src/relay/` (and port back if `relay-server/` ever
  needs to match).

## Commands

There is no build step, no linter, and no automated test suite for
relay-server or mobile-pwa. counter-app has one build step: packaging
into an installer (see below).

```
cd counter-app && npm install && npm start            # unpackaged dev run — embedded relay on :4000 (PORT env var to change) + real printer
cd counter-app && npm run dist                        # packages an installer (dist/*.exe) — see "Packaging and distribution"
# mobile-pwa has no server or npm scripts of its own: counter-app's embedded relay serves
# mobile-pwa/public (see src/relay/staticServer.js); phones use the Tailscale Funnel https://…ts.net address
# relay-server/ still runs standalone the old way (npm install && npm start) if you need it for
# reference/comparison, but this is not how production works anymore — see "Merging relay-server
# into counter-app" below.
```

`counter-app` needs a `.env` for anything other than defaults —
`RELAY_URL`, `PRINTER_NAME`, `PRINT_COPIES`. Unlike the other two
components, this file is **not** read from the project folder — see
"Where counter-app's writable files live" below. `PRINTER_NAME` is
normally set via the tray icon, not by hand.

**Critical, hard-won native-module lessons — read before touching
`better-sqlite3` in either Node component:**
- If you ever see a native crash (a segfault, an access violation, or a
  Node assertion failure like `RemoveEnvironmentCleanupHook`) after
  touching this dependency, don't assume a fix is real just because a
  quick test didn't reproduce it — a short external `timeout` on the
  test process can mask a crash by killing the process before it
  occurs. This happened once already (see git history on
  `counter-service`) and produced a false "fixed" belief that had to be
  walked back. Verify with several unbounded (or ≥4s bounded) full runs.
- **`counter-app` (Electron) needs `better-sqlite3@^12.x`, specifically
  rebuilt against Electron's own ABI — NOT the plain-Node build, and NOT
  v13.x.** v13.x's N-API rewrite segfaults inside `new Database()` on
  Node 20/22 (confirmed: [better-sqlite3#1514](https://github.com/WiseLibs/better-sqlite3/issues/1514)) — and Electron 33 bundles Node
  20.18.3, squarely in the affected range. v12.x doesn't have that bug,
  but its prebuild is tied to a specific `NODE_MODULE_VERSION` (ABI),
  not N-API-portable — installing it normally (`npm install`) fetches a
  binary built for the *plain Node.js* running the install, which then
  fails to load in Electron with `NODE_MODULE_VERSION` mismatch
  (Electron 33 = ABI 130; Node 24 = ABI 137). Install it correctly with:
  ```
  npm_config_runtime=electron npm_config_target=<electron version> npm_config_arch=x64 npm_config_disturl=https://electronjs.org/headers npm install better-sqlite3@^12
  ```
  (rerun after `rm -rf node_modules/better-sqlite3` if npm no-ops
  because the version range is already satisfied). Verify with:
  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe -e "new (require('better-sqlite3'))(':memory:')"` —
  this runs Electron's *actual bundled Node*, skipping Chromium/GPU
  entirely, so it's a fast, reliable way to test this specific class of
  bug without needing a full GUI launch.
  `electron-builder`'s own native-rebuild step (`@electron/rebuild`,
  which runs by default) does NOT reliably get this right either — it
  tried to compile from source and failed for lack of Visual Studio.
  `package.json`'s `build.npmRebuild: false` disables that step; the
  correctly-targeted binary installed above is used as-is.

## Architecture

### Deployment topology (current, deliberate decision)

**One installed app, one process, on the counter PC.** `counter-app`
embeds the relay in the same Electron process as the printer service
(see "Merging relay-server into counter-app" below) — not on separate
machines, not on a VPS, and the PWA is NOT hosted on a separate static
host (Cloudflare/GitHub Pages were considered and rejected as an
unnecessary extra moving part). Staff phones are **Android only**. The
counter PC is exposed over HTTPS with a free, permanent **Tailscale
Funnel** address (`tailscale funnel --bg 4000` → `https://<pc>.<tailnet>.ts.net`,
which `counter-app` now enables automatically on startup — see below);
the restaurant's internet is reliable and is now a hard dependency.
Setup steps are in the root README. Don't go back to LAN-IP-based
setups (the user can't look up or manage IPs), and don't point an HTTPS
page at a plain `ws://` LAN relay — browsers block that as mixed content.

- **The embedded relay also serves the PWA's static files**
  (`counter-app/src/relay/staticServer.js`, from `mobile-pwa/public`,
  bundled into the installer via `package.json`'s `build.extraResources`
  since a packaged app has no sibling folders on the target machine to
  read it from — see "Merging relay-server into counter-app") on the
  same port, so the one Funnel address is both where phones install the
  app and the relay they send to. `mobile-pwa/public/config.js` →
  `relayUrl` is `window.location.origin` (the relay is wherever the page
  was loaded from); only hardcode a URL if the PWA is ever hosted
  somewhere other than the relay. HTTPS via Funnel is what makes it a
  real PWA install (service worker, offline shell) on Android Chrome.
- The relay is publicly reachable and has **no authentication** — anyone
  with the URL can submit orders that print. Known and accepted for now;
  a shared access code is the obvious next step.
- The printer-service half of `counter-app` still talks to its own
  embedded relay half over `RELAY_URL=http://localhost:4000` (loopback,
  same process, same default if unset) — an intentional leftover of the
  two-piece design (see below), not a mistake.
- Single-counter design throughout: there is no `counterDeviceId` or
  multi-counter routing anywhere in the protocol. Adding one back would
  be a real feature, not a bug fix.

Moving the relay to a separate always-on device or a VPS is not the
current setup; don't build toward it speculatively.

### Merging relay-server into counter-app

**Why**: the user's explicit requirement was one installer, zero manual
setup steps on the counter PC ("i will not run anything manual"). Before
this, `relay-server` was a separate Node process needing its own
`install.bat` run (Node.js install, a Startup-folder shortcut, etc.) —
a real, working, but separate step the user reasonably didn't expect to
need after being handed a single `.exe`. `relay-server` turned out to be
simple enough (plain Node + `socket.io`, no native dependencies) to
embed directly rather than keep as a separate process.

**How**: `relay-server/src/index.js`, `queueManager.js`, and
`staticServer.js` were ported near-verbatim into
`counter-app/src/relay/server.js`/`queueManager.js`/`staticServer.js` —
protocol and behavior unchanged (see `relay-server/README.md` for the
full Socket.io protocol, still accurate). The only real changes:
- `server.js` exports a `start(port)` function instead of running at
  require-time, called from `counter-app/src/main.js`'s `main()`.
- Logging goes through `counter-app`'s shared `logger.js` (prefixed
  `[relay]`) instead of `relay-server`'s own plain `console.log`, so
  relay and printer activity land in the same `counter-app.log`.
- `staticServer.js`'s PWA root can no longer be `path.join(__dirname, '..', '..', 'mobile-pwa', 'public')`
  (a packaged app has no sibling `mobile-pwa` folder on the target
  machine) — it's `process.resourcesPath/mobile-pwa-public` when
  packaged (`app.isPackaged`), copied there at build time by
  `package.json`'s `build.extraResources: [{ "from": "../mobile-pwa/public", "to": "mobile-pwa-public" }]`,
  or the original sibling-folder path when run unpackaged for local dev.

**What this does NOT change**: the counter-side printer logic still
connects to the relay as an ordinary `socket.io-client`, over
`RELAY_URL` (loopback), exactly as when they were separate processes —
`counter-app/src/socketClient.js` is untouched. This was deliberate:
merging the *deployment* (one process, one installer) without also
collapsing the *protocol boundary* (still two logical sides talking
Socket.io) kept the change low-risk — the already-tested reconnect
logic, retry rules, and event handling needed zero changes.

**Tailscale Funnel auto-enable** (`counter-app/src/tailscale.js`,
`ensureFunnel()`, called from `main()`): best-effort, not a substitute
for Tailscale's own one-time setup. It looks for an already-installed
`tailscale.exe` at the usual path and runs `tailscale funnel --bg
<port>` if found; if Tailscale isn't installed, or is installed but not
yet signed in, this fails harmlessly (logged as a warning, not thrown)
and does nothing else — **installing Tailscale and signing in remains a
real, interactive, one-time human step no installer can safely
automate** (it's a VPN/auth flow). Don't try to script around that with
a stored auth key or similar without the user explicitly asking for it
— that's a real security decision, not a convenience shortcut to make
unilaterally.

### Order lifecycle and where durability actually lives

The relay has **no database** — it holds orders in an in-memory `Map`
(`counter-app/src/relay/queueManager.js`) only until the counter app acks
receipt. counter-app's SQLite database (in its userData folder, see
below) is the sole durable store, written **before** any ack is sent,
before any print is attempted. If the relay process restarts while
orders are queued (counter offline), those orders are gone from the
relay — this is an accepted tradeoff, not a bug, and it's why the PWA's
15-second "not confirmed — call manager" warning exists (see below).

Order status in SQLite: `pending` → `printing` → `printed` (row deleted
on success — no history is kept beyond the active queue) or `error`
(kept, flagged for manual review). Two very different failure paths,
easy to conflate when touching `attemptPrint`/`resumeOnStartup` in
`counter-app/src/main.js`:
- A **caught** print error (printer offline, timeout) is a known
  failure → retried up to 3× (5s apart) → then `error`.
- A **crash or restart** while an order was mid-print (`printing`) is
  **never** auto-retried on the next startup, since it's physically
  unknown whether the ticket finished printing — it's logged as `NEEDS
  MANUAL REVIEW` and left for a human. Don't "fix" this into an
  auto-retry; duplicate tickets are the whole thing being avoided.

Full Socket.io protocol (`order:submit`, `order:delivered`,
`order:printed`, `order:error`, `counter:register`, `sync:request`) is
documented in `relay-server/README.md` — still accurate even though the
relay side now lives at `counter-app/src/relay/server.js` (ported
near-verbatim, see "Merging relay-server into counter-app" above); read
that doc before changing any event name or payload shape, and update it
alongside `counter-app/src/relay/` if the protocol ever changes.

### Where counter-app's writable files live (and a real asar bug to not repeat)

**Nothing writable is read from or written to the app's own installed
folder.** A packaged Electron app's source lives inside `app.asar` — a
single read-only archive file, not a real directory. Early in this
project's build, `.env`, `logs/`, `data/`, and the per-ticket temp `tmp/`
dir were all resolved relative to `__dirname`, which — once packaged —
pointed *inside* `app.asar`. Every write failed with `ENOTDIR, not a
directory`, visibly (Electron's default uncaught-exception dialog) for a
`mkdirSync` at module-load time, but this class of bug can also fail
silently depending on where it happens. **Fixed**: `counter-app/src/config.js`
uses `app.getPath('userData')` as the base for all of these instead. Do
not go back to `path.join(__dirname, ...)` for anything counter-app ever
writes.

That path is **not** what you'd guess from `productName` in
`package.json`'s `build` config (`"CounterCall Counter App"`) — Electron's
`app.getName()` (which `getPath('userData')` is keyed on) reads the
top-level `name` field instead (`"counter-app"`), unless the code
explicitly calls `app.setName(...)`. It doesn't. So the real, current
location is:
```
%APPDATA%\counter-app\.env
%APPDATA%\counter-app\data\counter.db
%APPDATA%\counter-app\logs\counter-app.log
%APPDATA%\counter-app\tmp\
```
If you ever add an `app.setName(...)` call, this path changes and
anything already installed needs its data/`​.env` migrated — don't do
that without a good reason and a migration step.

### The printed ticket (KOT)

The ticket is the user's POS KOT template, in `counter-app/src/kotTemplate.js`,
based on `KOT_TEMPLATE_SPEC.md` (80 mm roll, hand-tuned against a real
printer). **Don't restyle it casually** — no font/size/padding/column
changes without being explicitly asked; the spec says its numbers are
load-bearing (e.g. the 55 mm bottom padding is the blank tail before the
cut). The only intentional deviations are two header lines: "Delivery"
instead of "Dine In", and "Order No: N" instead of "Table No" (N is the
order number the staff type on the phone, stored as `order_number`; it
is unrelated to `orderId`, the internal UUID). Every ticket prints ONE
copy (the user wants one, not the spec's two; `PRINT_COPIES` can raise
it, sent as sequential jobs). `KOT - N` comes from a monotonically
increasing SQLite counter (`meta` table) that is never reset and
survives deleting printed orders.

A `BILL_TEMPLATE_SPEC.md` (repo root) exists as a customer-bill template from
a sister project, same restaurant/printer — brought in as a future styling
reference for the KOT (a merge was tried and reverted; "we will change it
later" per the user). CounterCall has no billing feature and doesn't
implement that bill; don't act on that file until asked again.

**Printing is via Electron's own native print pipeline** (`win.webContents.print()`
in `counter-app/src/printer.js`) — not ESC/POS, and (as of `counter-app`)
not the HTML → Edge headless → PDF → SumatraPDF pipeline either; that
was `counter-service`'s approach and is gone along with it.
`node-thermal-printer` was never used. Two real, hard-won bugs specific
to this pipeline, both fixed:

1. **A `show: false` print window can print blank.** The obvious way to
   print invisibly is a hidden `BrowserWindow({ show: false })` — this
   is literally what `KOT_TEMPLATE_SPEC.md` §5.1 recommends ("hidden,
   non-offscreen window"), and worked on whatever Electron version that
   spec's source app used. On Electron 33 it reproduced as: pipeline
   reports success, `order:printed` fires, and the printer feeds a
   short **blank** strip — Chromium had skipped painting the hidden
   window's content entirely before `print()` grabbed it. Fixed by
   actually showing the window (`show: true`), positioned far off any
   real monitor (`x: -2000, y: -2000`) with `frame: false` and
   `skipTaskbar: true`, plus `webPreferences: { backgroundThrottling: false }`
   — nothing is ever visible to the user, but Chromium now paints it
   like a normal window. If you ever see a blank/short strip again with
   no thrown error, suspect this class of bug before anything else.
2. **Page geometry needs an explicit `pageSize`, not the driver default.**
   `KOT_TEMPLATE_SPEC.md` explicitly says not to pass `pageSize`/`preferCSSPageSize`
   and to let "the driver's own configured paper form" govern the
   output — true for the SumatraPDF pipeline (which pre-renders a
   correctly-sized PDF before the driver ever sees it), but **not** true
   for Electron's native print: without `pageSize`, Chromium asks the
   printer driver for its *currently configured default* paper size,
   which may not be the tall custom 80×297mm form the CSS assumes —
   producing the same short-blank-strip symptom as bug #1, for a
   different reason. Fixed: `printOnce()` passes
   `pageSize: { width: 80000, height: heightMicrons }` (**microns**,
   not mm) explicitly, computed the same way the old SumatraPDF
   pipeline did — `Math.max(297mm, estimateHeightMm(order))` — erring
   tall is always safe on a continuous roll; never make this tighter.

`printer.js` verifies `PRINTER_NAME` matches an installed Windows printer
(via `webContents.getPrintersAsync()`, not `Get-Printer`/PowerShell like
the old pipeline) both at startup (`isPrinterReady`, informational) and
on every `printOrder` call (throws if not — a stale/misspelled name
would otherwise silently misroute or drop the job). **This PC had two
near-identical printer entries** (`RP80 Printer` and `RP80 Printer(1)`)
from the driver install — only one of them actually had the correct
paper form associated; if printing produces a wrong-size blank strip
again after checking bugs #1/#2 above, check for and try the other
duplicate entry via the tray menu.

Each ticket is rendered into a per-order temp dir under
`%APPDATA%\counter-app\tmp\` (`config.kotTmpDir`) — **not** `os.tmpdir()`
(`%TEMP%`), for the same reason `counter-service` moved off it: on the
real counter PC, endpoint-security policy denied `mkdtemp` under
`%TEMP%` with `EPERM`. `tmp/` lives next to `data/` and `logs/` in the
app's own userData folder, which is not subject to the same lockdown.

### Printer selection (the tray icon)

counter-app is otherwise fully headless (see "no UI in production"
below) — the **one** UI surface is a tray icon (`counter-app/src/tray.js`),
right-click menu, listing every printer Windows knows about
(`getInstalledPrinterNames`) with the current one checked. Picking a
different one calls `config.setPrinterName(name)`, which updates the
running process immediately (no restart needed) **and** persists it to
`.env` in userData — picked once, remembered forever after, never edited
by hand. The tray icon itself is a small embedded base64 PNG data URL in
`tray.js` (not a separate asset file) — `nativeImage.createEmpty()` was
tried first and renders as an invisible/blank tray icon on Windows,
easy to miss entirely (this happened during testing: the app was running
correctly, there was just nothing visible to click).

### Dev mode vs production — no UI in production, by design

Unlike `counter-service` (which had a `DEV_MODE` browser-preview mode
for testing without hardware), **`counter-app` has no dev mode at all** —
it always drives the real printer. This is a deliberate simplification,
not an oversight: the dev-preview server was a workaround for
`counter-service`'s Edge/SumatraPDF pipeline being awkward to test
headlessly; `counter-app` can be run unpackaged (`npm start`) against a
real printer just as easily as packaged, so there was nothing left for
a separate preview mode to buy. Don't reintroduce one without a concrete
reason.

Only **one** `counter-app` instance may run at a time — enforced by
Electron's own `app.requestSingleInstanceLock()` in `src/main.js` (a
second instance calls `app.quit()` immediately, before doing anything
else, checked before `relay.start()` ever runs). This matters even more
now than it did for `counter-service`: since the relay is embedded (see
"Merging relay-server into counter-app"), a second instance wouldn't
just "win" order routing from a separate relay — it would try to bind
its own `http.createServer()` to the same port and fail outright
(`EADDRINUSE`), since `relay.start()` has no `EADDRINUSE`-handling of
its own (unlike `counter-service`'s old `devPreviewServer`, which did).
Keep the lock check first in startup code if touching it.

### Reconnection

`counter-app/src/socketClient.js` (unchanged from `counter-service`)
drives its own reconnect backoff (5s → 10s → 30s, capped) instead of
socket.io's built-in jittered backoff. It must handle **both**
`disconnect` (a connection that was up and dropped) and `connect_error`
(a connection that never succeeded in the first place) — a real bug here
was `connect_error` not triggering reconnection at all, leaving the
service stuck offline permanently after one failed attempt. Also don't
force `transports: ['websocket']`; let socket.io negotiate (polling →
upgrade), which is more tolerant of transient network issues than
forcing websocket-only.

### mobile-pwa specifics

- **Multiple restaurants share this one relay/counter/printer.**
  `public/menu.json` is `{ "restaurants": ["Name", ...], "items": [{ id,
  name }, ...] }` — restaurants and items are deliberately independent:
  ONE shared item catalog, items are never tagged/scoped to a restaurant
  (the user explicitly said so after an earlier per-restaurant-menu
  design was built and discarded — don't reintroduce per-restaurant item
  lists). The restaurant `<select>` is populated from `restaurants`, the
  item search always searches `items` regardless of selection, and
  adding/removing/renaming either is a `menu.json`-only change, never a
  code change. The order payload carries `restaurant` (the
  selected name); counter-app stores it (`db.js`) but the ticket
  deliberately does NOT print the restaurant name (the user said so).
  Every menu item is half/full uniformly now (no more per-item `sizes`
  list) — don't reintroduce per-item size restrictions without being
  asked.
- **Editing `menu.json` needs no cache-version bump or redeploy.** The
  service worker is network-first, so item/restaurant list changes
  reach already-installed devices on next load while online — see
  mobile-pwa/README.md. Only actual code files (`app.js`, `index.html`,
  etc.) need a `CACHE_NAME` bump.
- **An order has one or more items, each with its own note.** The form is
  the order-level card (restaurant + Order No, both required, set once per order
  — not per item), then item → half/full → qty → note → **Add item**, repeated,
  then **Send order** (a complete item still in the form is included on send).
  Items are `{ name, size, qty, note? }`; there is NO order-level notes field
  (the KOT's "Special Note" column is per item). History: it was multi-item,
  briefly single-item, and the user asked for multi-item again — keep it
  multi-item.
- **The item field never blocks on a menu match.** Whatever is typed is
  used as the item name whether or not it's in `menu.json`; the
  dropdown is a type-ahead convenience only. Half/Full is always
  selectable even with an empty menu.
- **Socket.io client is vendored locally**
  (`public/vendor/socket.io.min.js`), not loaded from a CDN — this is a
  local-first system and the restaurant WiFi may have no internet
  uplink at all. Don't switch this back to a CDN `<script src>`.
- **`crypto.randomUUID()` doesn't exist in insecure contexts** (plain
  `http://<lan-ip>`, which is exactly how phones reach this app — only
  `https://` or `localhost` are secure contexts). `app.js` has a
  `generateId()` fallback for this; don't call `crypto.randomUUID()`
  directly in browser code again.
- **`service-worker.js` is network-first, not cache-first.** A
  cache-first version previously caused an already-installed PWA to
  keep serving stale JS/menu data indefinitely with no visible error.
  `CACHE_NAME` must be bumped on every app-shell file change or edits
  won't reach devices that already have the service worker installed.

### Windows auto-start

**`relay-server`'s old mechanism is history, kept only for context** (it
doesn't run in production anymore — see "Merging relay-server into
counter-app"): `install.bat` created a Startup-folder shortcut pointing
at `run-all-hidden.vbs` → `relay-server/run-hidden.vbs` → that folder's
`run.bat` (a crash-restart loop), no visible console window, no Task
Scheduler, no SYSTEM account. That in turn replaced an even earlier
Task Scheduler/SYSTEM design, abandoned after repeated, hard-to-diagnose
failures on the real counter PC (PowerShell execution-policy blocked
`npm install`, then a native build failed for lack of network access to
fetch a prebuilt binary). The user does sign in to the counter PC day to
day (running a till), so "must survive nobody signing in" was dropped as
a requirement back then — still true now, `counter-app` also assumes
someone signs in daily.

**`counter-app`** (the only thing that actually auto-starts now): the
user's requirement here is stronger than "starts at
sign-in" — "never stop, until I uninstall or delete it," i.e. survive a
crash mid-session too, not just a reboot. `app.setLoginItemSettings`
alone (an earlier version of this app used only that) doesn't cover
that — it does nothing once the app is already running and later dies.
`counter-app/src/watchdog.js` (`ensureWatchdog()`, called from `main()`
every launch, no-ops when unpackaged) instead brings back the same
crash-restart-loop pattern relay-server uses, adapted to watch the
*installed* exe: it writes a small `watchdog.bat`/`.vbs` pair into the
app's own userData folder (`%APPDATA%\counter-app\watchdog\`), points a
Windows **Startup folder** shortcut at the `.vbs` (so it also starts at
sign-in, same mechanism as relay-server), and starts that loop
immediately too — not just registered for next sign-in — so resilience
doesn't wait for a reboot to take effect. The loop **polls** (`tasklist`
check every 5s, launch only if not already running) rather than
"launch-and-block-until-exit" like relay-server's `run.bat` — a
blocking loop's first iteration would race the already-running instance
it was just started from (the new copy hits
`requestSingleInstanceLock()` and quits immediately), so a blocking loop
would just keep relaunching-and-quitting a copy every 5s for as long as
the real instance stays up. `ensureWatchdog()` also checks (via
`Get-CimInstance Win32_Process`, matching `Name -eq 'cmd.exe'` with
`watchdog.bat` in the command line — see the self-matching bug below for
why it's `Name` + `CommandLine`, not `CommandLine` alone) whether a loop
is already running before starting another — without that check, every
relaunch (including ones the watchdog itself triggered) would pile up a
redundant polling loop running forever alongside the earlier ones.

This supersedes `setLoginItemSettings` — don't run both, or two copies
launch at sign-in (one via the registry Run key, one via this Startup
shortcut). The Quit tray item is now labeled **Restart** and says so in
its confirmation dialog, since the watchdog relaunches the app within
~5s regardless of why it exited (crash, or a deliberate Quit) — there is
now no tray action that actually stops the app long-term. To fully stop
it, uninstall (see `installer.nsh` — a custom NSIS uninstall hook
removes the Startup-folder shortcut, since it lives outside the app's
own install directory and the default uninstaller wouldn't otherwise
know about it; `nsis.deleteAppDataOnUninstall: true` removes the rest,
including the watchdog scripts themselves, from userData) or delete the
install directory directly.

**A real bug in the "is a loop already running" check, already fixed —
don't reintroduce it.** `ensureWatchdog()`'s check originally filtered
`Get-CimInstance Win32_Process` on `CommandLine -like '*watchdog.bat*'`
alone. That check runs via `powershell.exe -Command "..."`, and the
`-Command` string **itself contains the literal text `watchdog.bat`**
(it's right there in the filter pattern) — so the check's own process
always matched its own search, always reported "yes, already running,"
and silently skipped starting the loop on every single launch. No error
was ever thrown (matching itself isn't a failure), so this was
completely silent: the app worked fine in every other respect, the
watchdog files existed on disk, the Startup shortcut was created
correctly — the only symptom was that clicking Restart (or an actual
crash) never brought the app back, discovered only by noticing the log
never contained "Watchdog started" or any related line at all, for any
session, ever. Fixed by also filtering on `Name -eq 'cmd.exe'` (the
actual loop always runs as `cmd.exe`, per `watchdog.vbs`'s `cmd /c
"..."`; the check's own process is `powershell.exe`, so this excludes
the false self-match). The general lesson: a shell command that greps
for a string which also appears in its own invocation will match
itself — watch for this pattern anywhere a process-existence check is
built by embedding the same string being searched for into the search
command's own command line.

`install.bat`/`start-services.bat`/`run-all-hidden.vbs`/`relay-server/run.bat`
are **not used in the current deployment** (see "Merging relay-server
into counter-app" above) — `counter-app` is fully self-starting and
self-healing on its own via the watchdog described above, with no
separate relay process to start or monitor. These files are kept as a
fallback/reference only, in case the embedded-relay decision is ever
reverted; don't extend them expecting changes to reach production, and
don't assume they're what's actually running on a real counter PC
without checking `counter-app`'s own log first.

**`node_modules` for `relay-server` is still committed to git** for the
same historical reasoning (see `.gitignore` comments) in case it's ever
run standalone again, even though nothing in production does that now.
**`counter-app/node_modules` is deliberately NOT committed** — see
"Packaging and distribution" below, this component is distributed a
different way entirely. Don't add `relay-server/node_modules` back to
`.gitignore`, and don't reintroduce Task-Scheduler/SYSTEM/auto-login/netplwiz
for either component.

### Packaging and distribution (counter-app only)

Unlike the other two components, **`counter-app`'s dependencies are not
committed to git and it is not deployed via `git pull` + `npm start`.**
Electron's own binary alone is ~180MB — over GitHub's 100MB per-file
push limit — and real Electron apps aren't distributed by git-cloning an
unpacked runtime tree anyway; they're packaged into an installer.

`npm run dist` (→ `electron-builder --win --x64`, config in
`package.json`'s `build` field) produces
`counter-app/dist/CounterCall Counter App Setup <version>.exe` — a
single, self-contained NSIS installer (~85MB) that needs nothing on the
target machine: no Node.js, no `npm install`, no native build tools.
Copy that one file to the counter PC directly (USB, network share — not
git) and run it. `package.json`'s `build.files`/`asarUnpack` config
unpacks `better-sqlite3`'s native binary from the asar archive (native
addons can't load from inside one); `build.npmRebuild: false` stops
`electron-builder` from trying to recompile it (see the `better-sqlite3`
note under Commands above). `build.extraResources` copies
`../mobile-pwa/public` into the packaged app's `resources/mobile-pwa-public/`
— see "Merging relay-server into counter-app" above for why the PWA
static files need bundling this way instead of the sibling-folder path
`relay-server` originally used. `dependencies` includes both `socket.io`
(the server package, for the embedded relay) and `socket.io-client` (for
the printer side's own connection to it) — don't remove either thinking
one is redundant; they're genuinely two different packages for the two
sides of the same loopback connection.

**Building the installer requires Windows Developer Mode enabled** on
the machine doing the build (Settings → Privacy & security → For
developers → Developer Mode). Without it, `electron-builder` fails
extracting its bundled `winCodeSign` tooling with `Cannot create
symbolic link: A required privilege is not held by the client` — this
happens even for an unsigned, Windows-only build; `winCodeSign` is
fetched regardless of signing intent or target platform.
`CSC_IDENTITY_AUTO_DISCOVERY=false` does **not** avoid this fetch, don't
rely on it to. Developer Mode (or running the build as Administrator)
is the actual fix; don't try to route around the underlying Windows
symlink-privilege restriction any other way (e.g. registry edits made
on the user's behalf) — this is the user's call to make on their own
machine.

**Running the installer can also hit Windows 11's Smart App Control**
(SAC), which blocks unsigned executables by design — separate from, and
in addition to, the Developer Mode build-time issue above. Real code
signing (a paid certificate from a CA, identity-verified) is the proper
fix but isn't something achievable mid-session. **SAC can only be turned
OFF, not toggled** — Microsoft made it one-way; re-enabling it requires
a full Windows reset/clean install. This is a materially bigger
tradeoff than Developer Mode and must be the user's own explicit,
informed choice (Settings → Privacy & security → Windows Security →
App & browser control → Smart App Control → Off) — don't suggest it
casually, and never do anything to weaken it on the user's behalf
without them asking.

## Keeping this file current

This file must be updated whenever a change alters something described
above — a new protocol event, a changed default, a new gotcha
discovered the hard way, a deployment topology change, etc. Treat it as
living documentation, not a one-time snapshot.
