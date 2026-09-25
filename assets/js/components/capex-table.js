import { escapeHtml, euro, months, statusClass } from "../core/formatters.js";
import { annualDepreciation, annualPaymentSummary } from "../core/capex-plan.js";

const modeLabels = {
  manuale: "Piano manuale",
  fornitore: "Rate fornitore",
  finanziamento: "Rate finanziamento",
};

export function capexHeadHtml(year) {
  return `<th>Commessa</th><th>Voce</th><th>Fonte / piano</th><th>Vita utile</th><th>Stato</th>${months.map((month) => `<th class="num">${month}</th>`).join("")}<th class="num">Pagamenti ${escapeHtml(year)}</th><th class="num">Capitale residuo</th><th class="num">CAPEX iniziale</th><th class="num">Rettifiche</th><th class="num">CAPEX aggiornato</th><th class="num">Ammortamento ${escapeHtml(year)}</th><th>Azioni</th>`;
}

export function capexRowsHtml(components, year, budgetYear) {
  return components.map((component) => {
    const annual = annualPaymentSummary(component, year, budgetYear);
    const depreciation = annualDepreciation(component, year, budgetYear);
    const mode = modeLabels[component.paymentMode || "manuale"];
    return `<tr><td>${escapeHtml(component.project)}</td><td>${escapeHtml(component.component)}</td><td>${escapeHtml(component.source)}<br><small class="muted">${mode}</small></td><td>${component.life} anni</td><td><span class="status ${statusClass(component.state)}">${escapeHtml(component.state)}</span></td>${annual.cash.map((value, index) => `<td class="num"><button class="capex-month-button" type="button" data-edit-payment="${escapeHtml(component.id)}|${index}" aria-label="Apri il piano di ${months[index]} ${year} per ${escapeHtml(component.component)}">${euro.format(value)}</button></td>`).join("")}<td class="num">${euro.format(annual.cashTotal)}</td><td class="num">${euro.format(annual.remainingPrincipal)}</td><td class="num">${euro.format(component.approved)}</td><td class="num">${euro.format(component.adjustment)}</td><td class="num">${euro.format(component.approved + component.adjustment)}</td><td class="num">${euro.format(depreciation)}</td><td><button class="btn small" type="button" data-edit-component="${escapeHtml(component.id)}" aria-label="Modifica ${escapeHtml(component.component)}">Modifica voce</button></td></tr>`;
  }).join("");
}

export function capexTotals(components, year, budgetYear) {
  return components.reduce((total, component) => {
    const annual = annualPaymentSummary(component, year, budgetYear);
    return {
      payments: total.payments.map((value, index) => value + annual.cash[index]),
      annualCash: total.annualCash + annual.cashTotal,
      remainingPrincipal: total.remainingPrincipal + annual.remainingPrincipal,
      approved: total.approved + component.approved,
      adjustment: total.adjustment + component.adjustment,
      depreciation: total.depreciation + annualDepreciation(component, year, budgetYear),
    };
  }, {
    payments: Array(12).fill(0), annualCash: 0, remainingPrincipal: 0,
    approved: 0, adjustment: 0, depreciation: 0,
  });
}

export function capexTotalHtml(total) {
  return `<tr class="total-row"><td colspan="5">TOTALE COMMESSA</td>${total.payments.map((value) => `<td class="num">${euro.format(value)}</td>`).join("")}<td class="num">${euro.format(total.annualCash)}</td><td class="num">${euro.format(total.remainingPrincipal)}</td><td class="num">${euro.format(total.approved)}</td><td class="num">${euro.format(total.adjustment)}</td><td class="num">${euro.format(total.approved + total.adjustment)}</td><td class="num">${euro.format(total.depreciation)}</td><td></td></tr>`;
}
