# Counter Service

Background process that runs on the counter PC. No UI — it's a persistent
WebSocket client to the relay server plus a local SQLite queue and a
thermal-printer driver (tickets are HTML printed through the normal Windows printer driver).

## Setup

```
cd counter-service
npm install
copy .env.example .env    # then set PRINTER_NAME
npm start
```

Single-counter design — there's exactly one relay and one counter service,
so no counter/register id is needed anywhere in the protocol.

## The printed ticket (KOT)

The layout is the KOT template from the POS (`src/kotTemplate.js`), used
as-is: 80 mm roll, 72 mm body, header of date/time, `KOT - N`, **Delivery**,
**Order No: N**, then an Item / Special Note / Qty table. Item text is
`Name (Full|Half)`; each item's own note goes in the note column (`--` if none);
no prices, no restaurant name. `Order No` is the number the staff typed on
the phone (it replaces the template's "Table No"). Only the "Dine In" and
"Table No" lines differ from the template (by request). Do not restyle it.

- `KOT - N` is a counter kept in SQLite (`meta` table) that only ever goes
  up, so it survives restarts and deleting printed orders.
- Every ticket prints **1 copy** by default (`PRINT_COPIES` can raise it; extra
  copies are sent as separate sequential jobs).
- Printing: Edge headless lays the HTML out, measures it, and saves a PDF
  whose page is exactly as tall as the ticket (so the template's 55 mm tail
  is the only blank paper); SumatraPDF then sends it to `PRINTER_NAME` with
  `noscale`. Edge ships with Windows; `setup-counter-pc.bat` installs
  SumatraPDF. The dev preview shows this same HTML.
- `npm run test-print` prints one sample ticket (KOT 999) to check the printer
  setup without the relay or a phone.
- Not yet verified on the real printer (only the PDF rendering was checked).
  If the physical output is off, first check the printer's paper form
  (driver form "Printer 80(72.1) x 297 mm") and that Sumatra printed at
  100%, before touching the template.

## Dev mode (no printer needed)

Setting `DEV_MODE=true` in `.env` replaces the real printer with a
ticket preview at **http://localhost:4100** with two buttons:

- **Accept** — simulates a successful print (order moves to `printed`)
- **Reject** — simulates a printer failure (goes through the same
  retry-then-`error` path a real failure would)

This lets you exercise both the happy path and the failure/manual-review
path without any hardware.

**The default (no `DEV_MODE` set, or `.env` missing entirely) is real
printer, no UI** — this is deliberate. On the real counter PC there is
nobody watching a browser tab, so if dev mode defaulted to "on" and
someone forgot to configure it, orders would silently queue forever
waiting for an Accept click that never comes. Only set `DEV_MODE=true`
on a development machine that has no printer attached.

## How it works

- **Connection**: connects to the relay over Socket.io and requests any
  orders the relay queued while this service was offline
  (`sync:request`). If the connection drops, it reconnects on a fixed
  backoff: 5s, 10s, then 30s (capped).
- **Durability**: every incoming order is written to SQLite
  (`data/counter.db`) with status `pending` *before* a delivery ack is sent
  back or printing is attempted. The relay holds nothing durable — this
  service is the source of truth.
- **Printing**: `pending` → `printing` → `printed`. On success the row is
  deleted (no history is kept beyond the active queue) and a
  `order:printed` event goes back through the relay to the originating PWA.
- **Failure handling**:
  - A caught print error (printer offline, timeout, etc.) is a *known*
    failure — retried up to 3 times (5s apart), then the order is marked
    `error` and flagged for manual review. It is never silently dropped.
  - A **crash or restart** while an order was mid-print leaves it in status
    `printing`. On the next startup, such orders are logged as
    `NEEDS MANUAL REVIEW` and are **never** auto-reprinted, since it's
    unknown whether the ticket physically finished printing before the
    crash. Resolve these by hand (check the printer, then update/delete the
    row in `data/counter.db`).
  - Redelivery of an order already known locally (e.g. the relay replayed
    its queue because our ack was lost) is deduplicated by `orderId` and
    will not print twice.
- **Logging**: every state transition is appended to
  `logs/counter-service.log` as well as stdout.

## Run automatically on Windows startup

Run `setup-counter-pc.bat` (repo root) once as Administrator. It
registers a Task Scheduler task that starts `run.bat` at Windows **boot**
as SYSTEM, so no one has to sign in and no password is stored. `run.bat`
restarts the service 5 seconds after any exit. Nothing is started by hand.

SYSTEM can reach a network printer (`tcp://...`) and machine-wide
installed printers; if a USB printer only works when signed in as a
specific user, use a network/IP printer or re-register the task under
that user.

Remove with: `schtasks /delete /tn "CounterCallCounterService" /f`.

## Files

- `index.js` - entry point; just requires `src/index.js`
- `src/db.js` - SQLite schema + queries (better-sqlite3)
- `src/kotTemplate.js` - the KOT ticket HTML/CSS, copied verbatim from KOT_TEMPLATE_SPEC.md
- `src/printer.js` - order to KOT mapping, renders via Edge headless to PDF, prints via SumatraPDF
- `src/socketClient.js` - relay connection with fixed backoff reconnection
- `src/index.js` - wiring, startup resume logic, retry/error policy

## Native crash history (Node 24 + better-sqlite3 on Windows)

`better-sqlite3@11.x` on Node 24 (Windows) crashed with a native
assertion failure (`RemoveEnvironmentCleanupHook`) — verified via 10
consecutive clean runs at 0% vs. 5 consecutive crashes at 100%
immediately beforehand, so this wasn't a fluke. An earlier hypothesis —
that this was caused specifically by `src/index.js` being the process
entry module, fixed by `index.js` wrapping it via `require()` — turned
out to be **wrong**: that "fix" only appeared to work because the
verification tests used a short external `timeout`, which killed the
process before the crash had a chance to occur, masking the real crash
rate. The actual fix was **upgrading to `better-sqlite3@13.x`**
(`^13.0.3`), which resolved it outright. The `index.js` → `src/index.js`
wrapper is kept anyway as a harmless extra precaution, but it was never
the real fix — don't rely on "just require it from elsewhere" as a
mitigation if a similar native crash ever resurfaces. If this recurs on
some future Node/Windows/better-sqlite3 combination, re-run the same
kind of bounded crash-rate test (`timeout 4 node index.js`, many
iterations, no artificial cutoff shorter than that) before concluding
anything "fixed" it.
