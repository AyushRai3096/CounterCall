# KOT (Kitchen Order Ticket) print template — reproduce exactly

**Instruction to Claude Code:** implement the kitchen ticket below in this codebase so that the printed
output is **identical** to the source application's. The HTML and CSS in sections 2–4 are the source of
truth and were tuned by hand against real printouts on the real printer. **Copy them verbatim. Do not
restyle, "clean up", change fonts, sizes, paddings or column widths.** Only adapt the data-mapping
(section 1) and the print plumbing (section 5) to this codebase's stack.

Target: 80 mm thermal roll, Windows printer driver (RP80-class, driver paper form "Printer 80(72.1) x 297 mm").
The ticket is HTML rendered through the normal Windows print driver — not ESC/POS.

---

## 1. Data contract

```js
kot = {
  created_at: '2026-09-13 17:05:00', // local time string; if falsy, "now" is used
  kot_number: 15,                    // integer, shown as "KOT - 15"
  table: { name: 'T23' },            // a leading "T"/"t" is stripped -> "Table No: 23"; missing -> "-"
  items: [
    { item_name: 'Veg Afghani Chicken (Full)', note: '', qty: 1 },
    { item_name: 'Rumali Roti',                 note: '', qty: 2 },
  ],
}
```

- `item_name` is ONE string. Variants are part of it, formatted `Name (Variant)`, e.g. `Spl Punjabi Chaap (Full)`.
  Do **not** split the variant onto its own line — it simply wraps naturally when the name is long.
- `note` is optional; when empty/missing the note column shows `--`.
- No prices anywhere on a KOT.

## 2. Template (JavaScript, verbatim)

```js
const esc = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 13/08/26 23:12 — dd/mm/yy hh:mm, 24-hour, zero-padded, local time. */
function stamp(value) {
  const d = value ? new Date(String(value).replace(' ', 'T')) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  const date = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return { date, time, full: `${date} ${time}` };
}

export function buildKotText(kot) {
  const when = stamp(kot.created_at);
  const rows = kot.items
    .map(
      (i) => `
      <tr>
        <td class="k-item">${esc(i.item_name)}</td>
        <td class="k-note">${esc(i.note || '--')}</td>
        <td class="k-qty">${i.qty}</td>
      </tr>`
    )
    .join('');

  return `
<div class="kot">
  <div class="k-head">
    <div>${when.full}</div>
    <div>KOT - ${kot.kot_number}</div>
    <div class="bold">Dine In</div>
    <div class="bold">Table No: ${esc(kot.table?.name?.replace(/^T/i, '') ?? '-')}</div>
  </div>

  <div class="dotted"></div>

  <table class="k-table">
    <thead>
      <tr>
        <td class="k-item">Item</td>
        <td class="k-note">Special<br/>Note</td>
        <td class="k-qty">Qty.</td>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}
```

## 3. Stylesheet (verbatim — every value matters)

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
  .dotted { border-top: 2px dotted #000; margin: 4px 0; }

  /* ---- KOT ---- */
  .k-head { text-align: center; font-size: 11.5px; line-height: 1.35; }
  .k-head .bold { font-size: 11.5px; }
  .k-table td { padding: 0; }
  .k-table thead td { font-size: 12px; }
  .k-item { width: 58%; font-weight: 700; font-size: 12px; }
  .k-table thead .k-item { font-weight: 400; }
  .k-note { width: 22%; text-align: center; }
  .k-qty  { width: 20%; text-align: center; }
`;
```

Why these numbers (do not "fix" them):
- `body` is **72 mm** wide on an **80 mm** roll (the driver's printable strip is 72.1 mm). Content width is
  therefore 72 − 2×7 = **58 mm**.
- `padding: 2mm 7mm 55mm` — top 2 mm, left/right 7 mm, **bottom 55 mm**. On this continuous-form driver the
  *bottom padding is the blank tail fed before the cut*; it was the only lever that actually changed the
  paper output. Changing it changes how much blank paper comes out after the ticket.
- `.k-item` column is **bold 12px**, so long names wrap onto a second line inside their own cell
  ("Veg Afghani" / "Chicken (Full)").
- Row spacing is deliberately tight: `.k-table td { padding: 0 }`.
- `border-style: double` is avoided on purpose (thermal drivers render it unreliably); `.dotted` is a 2px dotted rule.

## 4. Document wrapper (verbatim)

```js
export function toPrintableHtml(body, title) {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${esc(title)}</title>
<style>${STYLES}</style></head>
<body>${body}</body></html>`;
}
```

Usage: `toPrintableHtml(buildKotText(kot), \`KOT ${kot.kot_number} - ${kot.table?.name ?? ''}\`)`

## 5. Print plumbing (this is what made it come out correctly on paper)

The source app is Electron; these are hard-won findings about the printer/driver, so keep the behaviour
even if this codebase is a different stack.

1. **Render in a hidden, non-offscreen window** (`new BrowserWindow({ show: false })`). Offscreen windows
   hand `print()` an unpainted frame → blank strip.
2. **Load the HTML from a real temp file** (`fs.writeFileSync(tmp, html)` then `win.loadFile(tmp)`), **not** a
   `data:` URL — `print()` renders blank for `data:` URIs. Delete the temp file afterwards.
3. Wait ~**250 ms** after load before printing so layout/first paint settle.
4. Print options: `{ silent: true, printBackground: false, margins: { marginType: 'none' }, deviceName: <printer> }`.
   - **Do not** pass `pageSize`, `preferCSSPageSize`, custom margins or `copies` — for a device print
     `webContents.print()` ignores/forwards them unreliably and this driver ignored them; they caused
     blank/short output. Page geometry comes from the HTML/CSS above plus the driver's own paper form.
   - The printer must be a real installed Windows printer (not "Microsoft Print to PDF", which always
     opens a Save dialog). Selecting it once and persisting the choice is recommended.
5. **Copies:** every KOT prints **twice** (kitchen + counter). Implement it by calling `print()` **twice,
   sequentially** (await the first callback before the second) — not via the `copies` option.
6. Wrap each `print()` in a ~20 s timeout so a stuck spooler cannot freeze the UI; a failed print must never
   lose the saved order.
7. Preview-on-screen after printing is a *development-only* aid in the source app (gated on
   `!app.isPackaged`); it is not part of the template.

If this codebase is **not** Electron: reproduce the same HTML/CSS (sections 2–4) and send it through
whatever renders HTML to the Windows print driver at 72 mm width with the same 2/7/55 mm padding. Do not
switch to ESC/POS text — that cannot match this layout pixel-for-pixel.

## 6. What the printed ticket looks like (layout sketch)

```
        13/09/26 17:05          <- centered, 11.5px, regular
           KOT - 15             <- centered, 11.5px, regular
            Dine In             <- centered, 11.5px, BOLD
         Table No: 23           <- centered, 11.5px, BOLD
 ..................................   <- 2px dotted rule, 4px margin above/below
 Item          Special   Qty.    <- 12px regular; "Special" over "Note"; Qty centered
                Note
 Veg Afghani    --         1     <- item name 12px BOLD, wraps inside 58% column
 Chicken (Full)
 Rumali Roti    --         2
 (55 mm of blank paper follows)
```

Column widths: Item 58% · Special Note 22% (centered) · Qty 20% (centered).

## 7. Acceptance checklist

- [ ] Header is 4 centered lines: `dd/mm/yy hh:mm`, `KOT - N`, **Dine In**, **Table No: N**.
- [ ] Table header row reads `Item | Special Note (two lines) | Qty.`, regular weight.
- [ ] Item names bold, 12px; long names wrap inside their column; `(Full)`/`(Half)` is part of the name.
- [ ] Empty note prints `--`; qty centered; no prices.
- [ ] Body 72 mm wide, padding `2mm 7mm 55mm`; row padding 0; dotted 2px separator.
- [ ] Two physical copies per KOT via two sequential print calls.
- [ ] HTML loaded from a temp file (not `data:`), hidden non-offscreen window, 250 ms settle.
