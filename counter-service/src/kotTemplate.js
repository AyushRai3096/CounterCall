'use strict';

// KOT (Kitchen Order Ticket) template, copied verbatim from KOT_TEMPLATE_SPEC.md
// (80 mm thermal roll, tuned by hand against real printouts). Do NOT restyle,
// re-space or change fonts/sizes/column widths. The only deliberate change from
// the spec are two header lines: "Delivery" instead of "Dine In", and
// "Order No: <number entered on the phone>" instead of "Table No".

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

function buildKotText(kot) {
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
    <div class="bold">Delivery</div>
    <div class="bold">Order No: ${esc(kot.order_number ?? '-')}</div>
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

function toPrintableHtml(body, title) {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${esc(title)}</title>
<style>${STYLES}</style></head>
<body>${body}</body></html>`;
}

module.exports = { buildKotText, toPrintableHtml };
