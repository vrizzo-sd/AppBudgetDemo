import { escapeHtml, euroCents } from "../core/formatters.js";

const percent = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value, signed = false) => value === null ? '<span title="Consuntivo non disponibile per tutti i mesi selezionati">—</span>' : `${signed && value > 0 ? "+" : ""}${euroCents.format(value)}`;

export function varianceRowsHtml(root, expanded) {
  const render = (row, depth) => {
    const branch = row.children.length > 0, open = expanded.has(row.id);
    const label = `${row.code ? `${row.code} · ` : ""}${row.name}`;
    return `<tr class="${depth === 0 ? "variance-total" : branch ? "variance-group" : ""}">
      <th scope="row" style="--tree-depth:${depth}">${branch
        ? `<button class="variance-toggle" type="button" data-variance-toggle="${escapeHtml(row.id)}" aria-expanded="${open}" aria-label="${open ? "Comprimi" : "Espandi"} ${escapeHtml(label)}">${open ? "▾" : "▸"}</button>`
        : '<span class="variance-leaf" aria-hidden="true"></span>'}${escapeHtml(label)}</th>
      <td class="num">${money(row.initial)}</td><td class="num">${money(row.adjustment, true)}</td>
      <td class="num">${money(row.updated)}</td><td class="num">${money(row.actual)}</td>
      <td class="num">${money(row.delta, true)}</td><td class="num">${row.percent === null ? "—" : `${row.percent > 0 ? "+" : ""}${percent.format(row.percent)}%`}</td></tr>` +
      (branch && open ? row.children.map((child) => render(child, depth + 1)).join("") : "");
  };
  return render(root, 0);
}
