import { escapeHtml, euro, months, statusClass } from "../core/formatters.js";

export function adjustmentListHtml(adjustments) {
  return adjustments
    .map(
      (adjustment) =>
        `<article class="adjustment"><div class="adjustment-top"><strong>${adjustment.id}</strong><span>${adjustment.scope === "capex" ? "CAPEX" : adjustment.nature === "cost" ? "Costo" : "Ricavo"} · ${escapeHtml(adjustment.rowLabel)}</span><div class="spacer"></div><span class="status ${statusClass(adjustment.status)}">${escapeHtml(adjustment.status)}</span></div><p><b>${adjustment.amount >= 0 ? "+" : ""}${euro.format(adjustment.amount)}</b> · ${months[adjustment.month] || "Intero piano"} · ${escapeHtml(adjustment.reason)}</p>${adjustment.attachment ? `<p class="muted">Allegato: ${escapeHtml(adjustment.attachment)}</p>` : ""}${adjustment.status === "Bozza" ? `<p><button class="btn small blue" data-send-adjustment="${adjustment.id}">Invia ad approvazione</button></p>` : ""}</article>`,
    )
    .join("");
}
