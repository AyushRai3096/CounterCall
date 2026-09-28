# Relay Server

Sits between the mobile PWA and the counter service. No database —
orders live in memory until the counter service durably has them.
Single-counter design: one relay, one counter.

**Deployment**: runs on the same machine as the counter service (see the
root README), exposed to phones over HTTPS through a free Tailscale
Funnel (`tailscale funnel --bg 4000`). There's no separate host and no
authentication yet, so anyone with the Funnel address can submit orders.

## Setup

```
cd relay-server
npm install         # only if node_modules isn't already here — it's committed to this repo
npm start           # listens on :4000 by default (PORT env var to change)
```

## Also serves the mobile PWA

Any request that isn't `/health` or `/socket.io/` is served as a static
file from `../mobile-pwa/public` (override with the `PWA_DIR` env var,
implemented in `src/staticServer.js`; path traversal is blocked and
responses are `no-cache` so `menu.json` edits show up on the next load).
Phones open the Funnel `https://…ts.net` address in Chrome and Install.

## Run automatically on Windows startup

`install.bat` (repo root, run once as Administrator) puts a shortcut in
the Windows Startup folder that launches this folder's `run.bat` with no
console window the moment someone signs in, restarting it if it crashes.
It's launched separately from the counter service, so each restarts
independently. See the root README.

## Protocol

**PWA → relay**
- `order:submit` — `{ orderId, items: [{ name, size, qty, note? }], restaurant?, orderNumber? }`

**Relay → PWA** (routed back to the socket that submitted the order)
- `order:delivered` — `{ orderId }` — the counter has durably received it
- `order:printed` — `{ orderId }`
- `order:error` — `{ orderId, message }` — printing failed after retries, or malformed order

**Counter → relay**
- `counter:register` — sent on connect
- `sync:request` — "resend anything you're holding for me"
- `order:delivered` / `order:printed` / `order:error` — `{ orderId, message? }`

**Relay → counter**
- `order:new` — the full order object, one per event, sent immediately if
  the counter is connected or replayed in order once it (re)registers.

## Why no database

The counter service writes every order to SQLite before it ever acks
delivery, so it's the durable source of truth. The relay only needs to
bridge two live connections and hold orders in memory for the (hopefully
short) window where the counter is offline. If the relay process restarts,
in-flight orders are lost from its queue; the PWA will surface the
">15s not confirmed" warning, which is the correct behavior since it's
genuinely unknown whether the counter received them.
