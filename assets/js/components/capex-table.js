import { escapeHtml, euro, months, statusClass } from '../core/formatters.js';

export function capexHeadHtml(year) {
  return `<th>Commessa</th><th>Voce</th><th>Fonte</th><th>Vita utile</th><th>Stato</th>${months.map(month => `<th class="num">${month}</th>`).join('')}<th class="num">CAPEX iniziale</th><th class="num">Rettifiche</th><th class="num">CAPEX aggiornato</th><th class="num">Ammortamento ${escapeHtml(year)}</th><th>Azioni</th>`;
}

export function capexRowsHtml(components) {
  return components.map(component => `<tr><td>${escapeHtml(component.project)}</td><td>${escapeHtml(component.component)}</td><td>${escapeHtml(component.source)}</td><td>${component.life} anni</td><td><span class="status ${statusClass(component.state)}">${escapeHtml(component.state)}</span></td>${component.payments.map((value, index) => `<td class="num"><button class="capex-month-button" type="button" data-edit-payment="${escapeHtml(component.id)}|${index}" aria-label="Modifica pagamento di ${months[index]} per ${escapeHtml(component.component)}">${euro.format(value)}</button></td>`).join('')}<td class="num">${euro.format(component.approved)}</td><td class="num">${euro.format(component.adjustment)}</td><td class="num">${euro.format(component.approved + component.adjustment)}</td><td class="num">${euro.format(component.depreciation)}</td><td><button class="btn small" type="button" data-edit-component="${escapeHtml(component.id)}" aria-label="Modifica ${escapeHtml(component.component)}">Modifica voce</button></td></tr>`).join('');
}

export function capexTotals(components) {
  return components.reduce((total, component) => ({
    payments: total.payments.map((value, index) => value + component.payments[index]),
    approved: total.approved + component.approved,
    adjustment: total.adjustment + component.adjustment,
    depreciation: total.depreciation + component.depreciation
  }), { payments: Array(12).fill(0), approved: 0, adjustment: 0, depreciation: 0 });
}

export function capexTotalHtml(total) {
  return `<tr class="total-row"><td colspan="5">TOTALE COMMESSA</td>${total.payments.map(value => `<td class="num">${euro.format(value)}</td>`).join('')}<td class="num">${euro.format(total.approved)}</td><td class="num">${euro.format(total.adjustment)}</td><td class="num">${euro.format(total.approved + total.adjustment)}</td><td class="num">${euro.format(total.depreciation)}</td><td></td></tr>`;
}
