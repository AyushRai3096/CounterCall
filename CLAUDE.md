# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CounterCall: a local-first order relay system for a restaurant. Three
independent Node/JS components, no shared build tooling, no monorepo
tool (no lerna/nx/workspaces) — each folder is its own `npm install`.

- **mobile-pwa/** — order-entry PWA (phones, installed to home screen). Plain HTML/CSS/JS, no framework, no build step.
- **relay-server/** — Socket.io bridge between the PWA and the counter service. No database, in-memory only.
- **counter-service/** — runs on the counter PC. Persists orders to SQLite (better-sqlite3) before acking anything, then prints a KOT ticket on a Windows thermal printer (HTML → Edge headless PDF → SumatraPDF) or, in dev mode, shows it in a browser preview.

## Commands

There is no build step, no linter, and no automated test suite in this
repo — each component is run directly with `npm start`.

```
cd relay-server && npm install && npm start          # :4000 by default (PORT env var to change)
cd counter-service && npm install && npm start       # connects to relay, drives printer or dev preview (:4100)
# mobile-pwa has no server or npm scripts of its own: relay-server serves mobile-pwa/public
# (see staticServer.js); phones use the Tailscale Funnel https://…ts.net address
```

`counter-service` needs a `.env` (copy `.env.example`) for anything other
than defaults — see that component's README for every variable.

**Critical**: `counter-service` requires `better-sqlite3@^13.0.3`
(NOT `11.x`) — `11.x` on Node 24 + Windows crashed with a native
assertion failure (`RemoveEnvironmentCleanupHook`) close to 100% of the
time (verified: 5/5 crashed on `11.x`, 10/10 clean on `13.x`, same
code). If you ever see this crash again after touching this dependency,
don't assume it's fixed just because a quick test didn't reproduce it —
a short external `timeout` on the test process can mask the crash by
killing the process before it occurs; that's exactly what happened
here and produced a wrong "fixed by wrapping the entry module" belief
that had to be walked back. Verify with several unbounded (or ≥4s
bounded) full runs before believing anything "fixed" this class of bug.
`index.js` → `require('./src/index.js')` is kept as a harmless extra
precaution but was never the actual fix.

## Architecture

### Deployment topology (current, deliberate decision)

The relay server and the counter service run on **the same Windows PC**
(the counter PC) — not on separate machines, not on a VPS, and the PWA is
NOT hosted on a separate static host (Cloudflare/GitHub Pages were
considered and rejected as an unnecessary extra moving part). Staff
phones are **Android only**. The counter PC is exposed over HTTPS with a
free, permanent **Tailscale Funnel** address (`tailscale funnel --bg
4000` → `https://<pc>.<tailnet>.ts.net`); the restaurant's internet is
reliable and is now a hard dependency. Setup steps are in the root
README. Don't go back to LAN-IP-based setups (the user can't look up or
manage IPs), and don't point an HTTPS page at a plain `ws://` LAN relay
— browsers block that as mixed content.

- **The relay also serves the PWA's static files** (`relay-server/src/staticServer.js`,
  from `mobile-pwa/public`, override with `PWA_DIR`) on the same port, so the
  one Funnel address is both where phones install the app and the relay they
  send to. `mobile-pwa/public/config.js` → `relayUrl` is
  `window.location.origin` (the relay is wherever the page was loaded from);
  only hardcode a URL if the PWA is ever hosted somewhere other than the relay.
  HTTPS via Funnel is what makes it a real PWA install (service worker,
  offline shell) on Android Chrome.
- The relay is publicly reachable and has **no authentication** — anyone
  with the URL can submit orders that print. Known and accepted for now;
  a shared access code is the obvious next step.
- `counter-service/.env` → `RELAY_URL=http://localhost:4000` (same
  machine as the relay; this is also the default if unset).
- Single-counter design throughout: there is no `counterDeviceId` or
  multi-counter routing anywhere in the protocol. Adding one back would
  be a real feature, not a bug fix.

Moving the relay to a separate always-on device or a VPS is not the
current setup; don't build toward it speculatively.

### Order lifecycle and where durability actually lives

The relay has **no database** — it holds orders in an in-memory `Map`
(`relay-server/src/queueManager.js`) only until the counter service acks
receipt. The counter service's SQLite database
(`counter-service/data/counter.db`) is the sole durable store, written
**before** any ack is sent, before any print is attempted. If the relay
process restarts while orders are queued (counter offline), those
orders are gone from the relay — this is an accepted tradeoff, not a
bug, and it's why the PWA's 15-second "not confirmed — call manager"
warning exists (see below).

Order status in SQLite: `pending` → `printing` → `printed` (row deleted
on success — no history is kept beyond the active queue) or `error`
(kept, flagged for manual review). Two very different failure paths,
easy to conflate when touching `attemptPrint`/`resumeOnStartup` in
`counter-service/src/index.js`:
- A **caught** print error (printer offline, timeout) is a known
  failure → retried up to 3× (5s apart) → then `error`.
- A **crash or restart** while an order was mid-print (`printing`) is
  **never** auto-retried on the next startup, since it's physically
  unknown whether the ticket finished printing — it's logged as `NEEDS
  MANUAL REVIEW` and left for a human. Don't "fix" this into an
  auto-retry; duplicate tickets are the whole thing being avoided.

Full Socket.io protocol (`order:submit`, `order:delivered`,
`order:printed`, `order:error`, `counter:register`, `sync:request`) is
documented in `relay-server/README.md` — spans all three components, so
read that before changing any event name or payload shape.

### The printed ticket (KOT)

The ticket is the user's POS KOT template, in `counter-service/src/kotTemplate.js`,
copied verbatim from `KOT_TEMPLATE_SPEC.md` (80 mm roll, hand-tuned against a
real printer). **Never restyle it** — no font/size/padding/column changes; the
spec says its numbers are load-bearing (e.g. the 55 mm bottom padding is the
blank tail before the cut). The only intentional deviations are two header
lines: "Delivery" instead of "Dine In", and "Order No: N" instead of "Table No"
(N is the order number the staff type on the phone, stored as `order_number`;
it is unrelated to `orderId`, the internal UUID). Every ticket prints ONE copy (the user wants
one, not the spec's two; `PRINT_COPIES` can raise it, sent as sequential
jobs). `KOT - N` comes from a monotonically increasing SQLite counter
(`meta` table) that is never reset and survives deleting printed orders.

Printing is HTML → Edge headless → PDF sized to the ticket → SumatraPDF to
the Windows printer (`PRINTER_NAME`); it is NOT ESC/POS and
`node-thermal-printer` was removed. Electron (the spec's original route) was
rejected because the service runs at boot with nobody signed in. Only the PDF
rendering has been checked; the physical print on the real printer has not.
The dev-mode preview renders this same HTML.

### Dev mode vs production — no UI in production, by design

`counter-service`'s `DEV_MODE` swaps the real printer
(`src/printer.js`) for a browser ticket-preview with Accept/Reject
buttons (`src/devPreviewServer.js`, `:4100`) so both the success and
failure/retry paths can be exercised without hardware.

**`DEV_MODE` defaults to `false` (real printer, no UI)** — this was
deliberately flipped from an earlier "defaults to true" version. The
failure mode of defaulting to dev-mode-on is silent and severe: nobody
watches a browser tab on the real counter PC, so orders would queue
forever waiting for a click that never comes, with no visible error.
Never flip this default back.

Only **one** `counter-service` instance may run at a time — a second
instance will still connect to the relay (and "win" order routing,
since the relay only tracks one counter socket) while its own preview
server fails to bind `:4100`, silently swallowing orders into an
unreachable queue. `devPreviewServer.js` now exits loudly with
`process.exit(1)` on `EADDRINUSE` specifically to surface this; keep
that behavior if touching that file.

### Reconnection

`counter-service/src/socketClient.js` drives its own reconnect backoff
(5s → 10s → 30s, capped) instead of socket.io's built-in jittered
backoff. It must handle **both** `disconnect` (a connection that was up
and dropped) and `connect_error` (a connection that never succeeded in
the first place) — a real bug here was `connect_error` not triggering
reconnection at all, leaving the service stuck offline permanently after
one failed attempt. Also don't force `transports: ['websocket']`; let
socket.io negotiate (polling → upgrade), which is more tolerant of
transient network issues than forcing websocket-only.

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
  selected name); `counter-service` stores it (`db.js`) but the ticket
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

`relay-server/run.bat` and `counter-service/run.bat` are crash-restart
loops. The user CANNOT enable Windows auto-login or disable sign-in on the
counter PC, so startup must not depend on a user session: `setup-counter-pc.bat`
(repo root, run once as Administrator) registers both as Task Scheduler
`onstart` tasks running as SYSTEM (no password). Two independent tasks, so
either restarting doesn't affect the other. Tailscale and its persisted
Funnel config start on their own. The user requires that nothing on the
counter PC is ever started by hand — any new long-running process must be
added to that script. `start-services.bat` (desktop icon "Start CounterCall",
created by the setup script) is the manual backup: it self-elevates and runs
the two scheduled tasks via `schtasks /run`, relying on Task Scheduler's
default "do not start a new instance" so a second click can't create a
second counter service (never allowed, see above). Don't reintroduce onlogon/auto-login/netplwiz.

## Keeping this file current

This file must be updated whenever a change alters something described
above — a new protocol event, a changed default, a new gotcha
discovered the hard way, a deployment topology change, etc. Treat it as
living documentation, not a one-time snapshot.
