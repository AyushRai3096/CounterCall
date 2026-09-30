# Bill (customer receipt) print template — reproduce exactly

**Instruction to Claude Code:** implement the customer bill below in this codebase so that the printed
output is **identical** to the source application's. The HTML, CSS and GST math in sections 2–4 are the
source of truth and were tuned by hand against real printouts on the real printer. **Copy them verbatim.
Do not restyle, "clean up", change fonts, sizes, paddings, column widths or rounding order.** Only adapt
the data-mapping (section 1) and the print plumbing (section 5) to this codebase's stack.

Target: 80 mm thermal roll, Windows printer driver (RP80-class, driver paper form "Printer 80(72.1) x 297 mm").
The bill is HTML rendered through the normal Windows print driver — not ESC/POS.

If you're also porting the KOT template, see the companion file `KOT_TEMPLATE_SPEC.md` — sections 5–7
there (print plumbing, driver facts) apply to the bill too and aren't repeated in full here.

**Status in this codebase (CounterCall):** CounterCall has no billing feature — it's a KOT-only kitchen
ticket relay, no prices, no GST math, no customer receipt. This file was brought in only as a styling
reference: `counter-service/src/kotTemplate.js`'s divider (double rule) and item-table header (bottom
border) were deliberately borrowed from this bill's look, sharing a visual system across the two
projects' tickets. The bill itself (sections 1, 2, 4, 6 content-wise) is **not** implemented here — do
not add GST math, restaurant identity header, or a Price/Amount column to the KOT from this file without
being asked; see CLAUDE.md's "The printed ticket (KOT)" section.

---

## 1. Data contract

```js
// Restaurant identity — constant, printed on every bill header.
RESTAURANT = {
  name: 'Veer Ji Malai Chaap Wale',
  branch: '(Paschim Vihar)',
  address: 'ADD: SHOP NO. 52, BG-8, PASCHIM VIHAR, NEW DELHI-110063',
  contact: 'CONTACT: 7011161638, TEL: 011-44716249',
  gstin: 'GSTIN: 07KMYPK6611K1Z6',
  cashier: 'biller',
};

// Passed to buildBillText:
detail = {
  order: {
    id: 9,                              // -> "Bill No.: 9"
    billed_at: '2026-09-13 17:05:00',   // preferred for the date/time; falls back to created_at, then "now"
    created_at: '2026-09-13 16:40:00',
  },
  table: { name: 'T27' },               // leading "T"/"t" stripped -> "Dine In: 27"; missing -> "-"
  kots: [                               // only kot_number > 0 (fired KOTs) become "Token No."
    { kot_number: 1 },
    { kot_number: 2 },
  ],
  bill: { /* see below — this is the GST-math output, not raw order data */ },
};
```

### 1a. The `bill` object — GST math (reproduce this rounding exactly)

Menu prices are **GST-inclusive** (5% = 2.5% CGST + 2.5% SGST). Given raw KOT line items
`{ name, price, qty }` where `price` is the **gross per-unit menu price**:

```js
function buildBill(rawLines) {
  // rawLines: [{ name, price /* gross unit price */, qty, amount /* qty * price, gross */ }, ...]
  // grouped/summed by name+price, ordered by name.

  const lines = rawLines.map((l) => ({
    name: l.name,
    qty: l.qty,
    // Tax-exclusive values for the printed bill's Price/Amount columns.
    // ROUND EACH LINE'S AMOUNT FIRST, THEN SUM — do not divide the grand
    // total by 1.05, that loses a paisa against this exact bill.
    price: round2(l.price / 1.05),
    amount: round2(l.amount / 1.05),
  }));

  const subTotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const cgst = round2(subTotal * 0.025);   // 2.5%
  const sgst = round2(subTotal * 0.025);   // 2.5%
  const total = round2(subTotal + cgst + sgst);
  const roundedTotal = Math.round(total);  // what the customer actually pays
  const roundOff = round2(roundedTotal - total); // shown on the bill, can be + or -

  return {
    lines, subTotal, cgst, sgst, total, roundedTotal, roundOff,
    itemCount: rawLines.reduce((n, l) => n + l.qty, 0),
  };
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
```

**Do not compute `roundOff` as anything other than `roundedTotal - total`, and do not show it only when
non-zero** — see section 2, it prints unconditionally.

If this codebase already computes bills/orders differently, keep its own totals logic but make sure the
**printed bill's line Price/Amount are tax-exclusive, rounded per-line before summing**, and that
Sub Total → CGST → SGST → Round off → Grand Total appears in that order with those exact labels.

## 2. Template (JavaScript, verbatim)

```js
const esc = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n) => Number(n).toFixed(2);

/** 13/08/26 23:12 — dd/mm/yy hh:mm, 24-hour, zero-padded, local time. */
function stamp(value) {
  const d = value ? new Date(String(value).replace(' ', 'T')) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  const date = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return { date, time, full: `${date} ${time}` };
}

export function buildBillText(detail) {
  const { order, table, bill } = detail;
  const when = stamp(order.billed_at || order.created_at);

  const tokens = (detail.kots || [])
    .filter((k) => k.kot_number > 0)
    .map((k) => k.kot_number)
    .join(', ');

  const rows = bill.lines
    .map(
      (l) => `
      <tr>
        <td class="b-item">${esc(l.name)}</td>
        <td class="b-qty">${l.qty}</td>
        <td class="b-num">${money(l.price)}</td>
        <td class="b-num">${money(l.amount)}</td>
      </tr>`
    )
    .join('');

  const roundOff = bill.roundOff ?? 0;

  return `
<div class="bill">
  <div class="b-head">
    <div class="b-name">${esc(RESTAURANT.name)}</div>
    <div class="b-name">${esc(RESTAURANT.branch)}</div>
    <div class="b-addr">${esc(RESTAURANT.address)}</div>
    <div class="b-addr">${esc(RESTAURANT.contact)}</div>
    <div class="b-addr">${esc(RESTAURANT.gstin)}</div>
  </div>

  <div class="rule"></div>
  <div class="rule rule-gap"></div>

  <table class="b-meta">
    <tr>
      <td>Date: ${when.date}</td>
      <td class="right bold">Dine In: ${esc(table?.name?.replace(/^T/i, '') ?? '-')}</td>
    </tr>
    <tr>
      <td>${when.time}</td>
      <td></td>
    </tr>
    <tr>
      <td>Cashier: ${esc(RESTAURANT.cashier)}</td>
      <td class="right">Bill No.: ${order.id}</td>
    </tr>
    ${tokens ? `<tr><td colspan="2" class="bold">Token No.: ${esc(tokens)}</td></tr>` : ''}
  </table>

  <div class="rule"></div>

  <table class="b-table">
    <thead>
      <tr class="head-row">
        <td class="b-item">Item</td>
        <td class="b-qty">Qty.</td>
        <td class="b-num">Price</td>
        <td class="b-num">Amount</td>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="rule"></div>

  <table class="b-totals">
    <tr>
      <td>Total Qty: ${bill.itemCount}</td>
      <td class="right">Sub Total</td>
      <td class="b-num">${money(bill.subTotal)}</td>
    </tr>
    <tr>
      <td></td>
      <td class="right nowrap">CGST@2.5 2.5%</td>
      <td class="b-num">${money(bill.cgst)}</td>
    </tr>
    <tr>
      <td></td>
      <td class="right nowrap">SGST@2.5 2.5%</td>
      <td class="b-num">${money(bill.sgst)}</td>
    </tr>
    <tr class="roundoff">
      <td></td>
      <td class="right small">Round off</td>
      <td class="b-num small">${roundOff > 0 ? '' : roundOff < 0 ? '-' : ''}${money(Math.abs(roundOff))}</td>
    </tr>
    <tr class="grand">
      <td></td>
      <td class="right bold">Grand Total</td>
      <td class="b-num bold">₹${money(bill.roundedTotal)}</td>
    </tr>
  </table>

  <div class="rule"></div>

  <div class="b-thanks">Thanks</div>
</div>`;
}
```

Notes on exact behaviour:
- **Round off always prints**, even when it's `0.00` — do not hide the row when there's no rounding.
- Sign: shows `-` only when `roundOff < 0`; positive round-off has no `+` sign, just the number.
- `Grand Total` is prefixed with `₹`; nothing else on the bill has a currency symbol.
- `Token No.` row only appears when there's at least one fired KOT (`kot_number > 0`); it's omitted
  entirely otherwise (no empty row).
- `Price`/`Amount` columns are the **tax-exclusive** values; the order/settle screens elsewhere in a
  full app should show gross menu prices instead — that's a UI concern, not this template's.

## 3. Stylesheet (verbatim — every value matters)

This is the **shared** stylesheet also used by the KOT (see `KOT_TEMPLATE_SPEC.md`). If you're porting
the bill only, you still need the shared rules (`@page`, `body`, `table`, `td`, `.bold`, `.right`,
`.rule`, etc.) — they're included in full below.

```js
const STYLES = `
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: 72mm;
    box-sizing: border-box;
    font-family: "Segoe UI", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.25;
    color: #000;
    padding: 2mm 7mm 55mm;
  }
  * { box-sizing: border-box; }
  table { table-layout: fixed; }
  td { word-wrap: break-word; overflow-wrap: break-word; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 1px 0; }
  .bold { font-weight: 700; }
  .right { text-align: right; }
  .nowrap { white-space: nowrap; }
  .small { font-size: 10px; }

  /* A thick line is the "bold" look here. Two stacked .rule divs stand in for
     a double rule - border-style:double renders unreliably on thermal drivers. */
  .rule { border-top: 2px solid #000; margin: 2px 0; }
  .rule-gap { margin-top: 8px; }

  /* ---- bill ---- */
  .b-head { text-align: center; }
  .b-name { font-size: 13px; font-weight: 700; }
  .b-addr { font-size: 10px; line-height: 1.3; }
  .b-meta td { font-size: 12px; }
  .b-table thead td { font-size: 11.5px; }
  .b-item { width: 42%; }
  .b-qty  { width: 12%; text-align: center; }
  .b-num  { text-align: right; width: 25%; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .b-totals td { font-size: 12px; }
  .b-totals td.small { font-size: 10px; }
  /* A border on <tr> is not painted in print rendering, so the rules go on the
     cells: under the column header, and above round-off/grand total - that
     separator has to sit above Round off, not above Grand Total, or Round off
     visually reads as part of the CGST/SGST block instead of the total. */
  .b-table thead .head-row td { border-bottom: 1px solid #000; padding-bottom: 2px; }
  .b-table tbody tr:first-child td { padding-top: 3px; }
  .b-totals .roundoff td { padding-top: 4px; border-top: 1px solid #000; }
  .b-totals .grand td { font-size: 15px; padding-top: 2px; }
  .b-totals .grand td.b-num { padding-left: 5px; }
  .b-thanks { text-align: center; font-size: 12px; margin-top: 4px; }
`;
```

Why these numbers (do not "fix" them):
- `body` is **72 mm** wide on an **80 mm** roll (driver's printable strip is 72.1 mm); content width is
  72 − 2×7 = **58 mm**.
- `padding: 2mm 7mm 55mm` — the **55 mm bottom** is the blank tail this continuous-form driver feeds
  before cutting. It is the only thing that actually changes how much blank paper prints (see
  `KOT_TEMPLATE_SPEC.md` §5, point 3) — CSS `@page` size and Electron's `pageSize`/`margins` print
  options do **not**.
- `.b-num` gets **`white-space: nowrap`** and **25% width** (not less) — a narrower column made
  `₹350.00` wrap mid-digit onto two lines; this was a real, reproduced bug. Keep the nowrap.
- `.b-totals .grand td.b-num { padding-left: 5px }` — the gap between "Grand Total" and its amount is
  added on the **amount cell's left padding**, not the label's right padding. Padding the right-aligned
  label instead makes "Grand Total" wrap ("Grand" / "Total" on two lines) — also a reproduced bug, don't
  redo it that way.
- CGST/SGST labels get `.nowrap` for the same reason — "CGST@2.5 2.5%" wraps in the default 3-column
  fixed-width totals table otherwise.
- `.b-totals td.small` (not just `.small`) is required: a bare `.small` loses the CSS specificity fight
  against `.b-totals td { font-size: 12px }` and silently renders at the wrong size. This exact bug
  shipped once — keep the more specific selector.
- The horizontal rule sits **above the Round off row**, not above Grand Total (`.roundoff td` has the
  `border-top`, not `.grand td`) — otherwise Round off visually groups with CGST/SGST instead of with
  the total it belongs to.
- Two stacked `<div class="rule">` + `<div class="rule rule-gap">` under the header render as a double
  line; `border-style: double` was tried and rendered unreliably on the real printer.

## 4. Document wrapper (verbatim)

```js
export function toPrintableHtml(body, title) {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${esc(title)}</title>
<style>${STYLES}</style></head>
<body>${body}</body></html>`;
}
```

Usage: `toPrintableHtml(buildBillText(detail), \`Bill ${detail.order.id}\`)`

## 5. Print plumbing

Identical to the KOT — see `KOT_TEMPLATE_SPEC.md` section 5, points 1–4, 6–7. The one difference:
**the bill prints once** (not twice like the KOT); don't apply the double-print loop to it.

## 6. What the printed bill looks like (layout sketch)

```
             Veer Ji Malai Chaap Wale        <- centered, 13px BOLD
                (Paschim Vihar)               <- centered, 13px BOLD
      ADD: SHOP NO. 52, BG-8, PASCHIM VIHAR,  <- centered, 10px
              NEW DELHI-110063
       CONTACT: 7011161638, TEL: 011-44716249
           GSTIN: 07KMYPK6611K1Z6
 ==================================   <- two stacked 2px rules, 8px gap between
 Date: 13/09/26        Dine In: 27    <- left / right, right side BOLD
 17:05
 Cashier: biller         Bill No.: 9
 Token No.: 1, 2                      <- BOLD, only if KOTs were fired
 ----------------------------------   <- single 2px rule
 Item      Qty.   Price    Amount     <- 11.5px, bottom-bordered header row
 Coke 750 Ml        1      38.10      38.10
  With Glass
 Rumali Roti         2     14.29      28.57
 ----------------------------------
 Total Qty: 4        Sub Total       333.34
                   CGST@2.5 2.5%        8.33
                   SGST@2.5 2.5%        8.33
 ----------------------------------   <- rule directly above Round off
                      Round off        0.00   <- 10px, always shown
                    Grand Total     ₹350.00   <- 15px BOLD, gapped from amount
 ----------------------------------
               Thanks
```

Column widths: Item 42% · Qty 12% (centered) · Price 25% · Amount 25% (both right-aligned, nowrap).

## 7. Acceptance checklist

- [ ] Header: outlet name + branch bold 13px, address/contact/GSTIN 10px, all centered.
- [ ] Double rule under the header (two lines, visible gap), not a CSS double-border.
- [ ] Meta block: Date/time left, **Dine In: N** bold right; Cashier / Bill No.; Token No. only if any
      KOT was fired, bold, comma-separated.
- [ ] Item table: Item/Qty/Price/Amount header with a bottom rule; long names wrap in their own column;
      Price and Amount are tax-exclusive (menu price ÷ 1.05, rounded per line before summing).
- [ ] Totals: Sub Total → CGST@2.5 2.5% → SGST@2.5 2.5% → **rule** → Round off (always shown, small
      text, signed only when negative) → Grand Total (15px bold, `₹` prefix, gapped from its amount via
      the amount cell's padding).
- [ ] Grand Total number never wraps regardless of amount (`nowrap` + adequate column width).
- [ ] Single rule + "Thanks" (centered) at the very bottom.
- [ ] Bill prints once (not twice, unlike the KOT).
