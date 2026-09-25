# Mobile PWA

Order-entry app for remote staff. Deliberately simple — one screen: pick
the restaurant and type the **Order No** (both belong to the whole order,
in their own "Order" card), then for each item choose the item (searchable
dropdown), half/full, quantity and an optional note and tap **Add item**;
**Send order** sends every added item as one order. Restaurant and Order No
are required to send (the restaurant stays selected between orders; the
Order No is cleared for the next one). Plain HTML/CSS/JS — no build step, no framework.
Talks to the relay server over Socket.io, whose browser client is
vendored locally at
[public/vendor/socket.io.min.js](public/vendor/socket.io.min.js) rather
than loaded from a CDN — this is a local-first system and shouldn't
depend on internet access to even load the page.

## Setup

1. [public/config.js](public/config.js) needs no editing: `relayUrl` is
   the page's own origin, since the relay serves this app.
2. Edit [public/menu.json](public/menu.json) to match your actual menu.
   This is the **only** file that needs editing for any menu change —
   adding/removing/renaming a restaurant, or adding/removing items —
   no code change needed. Shape:
   ```json
   {
     "restaurants": ["Restaurant A", "Restaurant B"],
     "items": [{ "id": "...", "name": "..." }, ...]
   }
   ```
   Restaurants and items are independent: there is one shared item
   catalog, not a per-restaurant menu, and items are never tagged to a
   restaurant. The restaurant dropdown is built from `restaurants`; the
   item search always searches `items` whichever restaurant is selected.
   Every item is half/full (no per-item size list); the item field also
   accepts free-typed names not in the list (see below).

There is no separate server for this folder: `relay-server` serves
`public/` on its own port (default 4000), and a Tailscale Funnel puts
that behind a permanent HTTPS address (`https://<pc>.<tailnet>.ts.net`,
setup in the root README). On each Android phone, open that address in
Chrome and tap Install — HTTPS is what makes it a real installed PWA
with an offline copy. Phones are Android only. The app needs internet
to send orders; there is no LAN or IP setup.

## Status flow

Each submitted order shows one of: **Sent** → **Delivered to counter** →
**Printed**. If an order is still "Sent" 15 seconds after submission (no
`order:delivered` from the relay), a "not confirmed — call manager"
warning appears next to it. An `order:error` from the relay (e.g.
printing failed after retries) shows as "Needs attention" instead.

## Notes

- Device identity is a random id generated once and stored in
  `localStorage`, used by the relay to route delivery/print
  acknowledgements back to this device. Clearing site data resets it.
- Order status is in-memory only (lost on page reload) — matches the "no
  order history" requirement; the counter's SQLite queue is the durable
  record.
- The item field never blocks on a menu match — whatever is typed is used
  as the item name, whether or not it's in `menu.json`. The dropdown is
  just a type-ahead convenience; Half/Full is always selectable even with
  an empty menu.
- Editing `menu.json` alone (items or the restaurant list) needs **no
  cache-version bump and no redeploy step** — the service worker fetches
  it network-first, so already-installed devices pick up the new
  content on their next load while online. The `CACHE_NAME` bump is only
  needed when `index.html`/`styles.css`/`app.js`/etc. (actual code)
  changes.
- If the page seems stuck on old *code* behavior after you edit an
  app-shell file, it's almost always the service worker serving a stale
  cache — reload the page (or fully close/reopen the installed icon)
  once or twice. `CACHE_NAME` in `service-worker.js` must be bumped
  whenever an app-shell file changes for this to force through cleanly.
