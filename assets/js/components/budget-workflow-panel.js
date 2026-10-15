import { escapeHtml as esc, euroCents, months, statusClass } from "../core/formatters.js";
import { planningTotal, planningYearMonths } from "../core/budget-hierarchy.js";
import { planningRows } from "../core/budget-workflow.js";

const date = (value) => new Date(value).toLocaleString("it-IT");
const badge = (state) => `<span class="status ${statusClass(state)}">${esc(state)}</span>`;
const action = (scope, id, command, label, primary = false) => `<button type="button" class="btn small${primary ? " primary" : ""}" data-workflow-scope="${scope}" data-workflow-id="${esc(id)}" data-workflow-action="${command}">${label}</button>`;

export function budgetActionsHtml(budget) {
  const button = (command, label, primary) => action("budget", budget.id, command, label, primary);
  if (budget.workflowState === "Bozza") return button("submit", "Invia in approvazione", true);
  if (budget.workflowState === "In approvazione") return button("withdraw", "Ritira") + button("reject", "Respingi") + button("approve", "Approva e rendi ufficiale", true);
  if (budget.workflowState === "Respinto") return button("reopen", "Riapri bozza");
  return "";
}

function variationCellHtml(value, previousValue) {
  const difference = previousValue == null ? 0 : Math.round(value * 100) - Math.round(previousValue * 100);
  if (!difference) return `<td class="num">${euroCents.format(value)}</td>`;
  const delta = `${difference > 0 ? "+" : "−"}${euroCents.format(Math.abs(difference) / 100)}`;
  const description = `Prima: ${euroCents.format(previousValue)} · Dopo: ${euroCents.format(value)} · Variazione: ${delta}`;
  return `<td class="num variation-${difference > 0 ? "increase" : "decrease"}" title="${esc(description)}"><strong>${euroCents.format(value)}</strong><small class="variation-delta">${delta}</small></td>`;
}

export function planningSnapshotHtml(planning, budgetYear, previousPlanning = null) {
  const levels = planningRows(planning);
  const previousRows = previousPlanning ? planningRows(previousPlanning) : [];
  const years = [...new Set([budgetYear, ...levels.flatMap((row) => Object.keys(row.yearMonths || {}).map(Number))])].sort();
  const legend = previousPlanning ? '<p class="variation-legend">Rispetto alla revisione precedente: <span class="variation-increase">+ aumento</span><span class="variation-decrease">− diminuzione</span></p>' : "";
  return legend + years.map((year) => `<p><strong>Anno ${year}</strong></p><div class="table-wrap"><table class="snapshot-grid"><thead><tr><th>Codice</th><th>Descrizione</th>${months.map((month) => `<th>${month}</th>`).join("")}<th>Totale anno</th></tr></thead><tbody>${levels.map((row) => {
    const values = planningYearMonths(row, year, budgetYear);
    const previousRow = previousRows.find((item) => item.id === row.id);
    const previous = previousPlanning ? previousRow ? planningYearMonths(previousRow, year, budgetYear) : Array(12).fill(0) : null;
    const total = values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;
    const previousTotal = previous ? previous.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100 : null;
    return `<tr><td>${esc(row.code)}</td><td>${esc(row.name)}</td>${values.map((value, month) => variationCellHtml(value, previous?.[month])).join("")}${variationCellHtml(total, previousTotal)}</tr>`;
  }).join("")}</tbody></table></div>`).join("");
}

export function workflowPanelHtml(budget) {
  return `<div class="workflow-heading"><strong>Versione ${budget.version} · Revisione ${budget.revision}</strong>${badge(budget.workflowState)}${budget.isOfficial ? '<span class="official-badge">Versione ufficiale</span>' : ""}${budgetActionsHtml(budget)}</div>`;
}

export function workflowHistoryHtml(budget) {
  return `<section class="panel" aria-label="Revisioni approvate"><details id="budget-revisions" open><summary class="panel-title">Revisioni approvate (${budget.revisions.length})</summary><div class="workflow-history-body">${budget.revisions.map((revision, index) => `<details class="monthly-history-entry"><summary>Revisione ${revision.number} · ${esc(date(revision.at))} · ${esc(revision.actor)} · ${euroCents.format(planningTotal(revision.planning))}</summary><p>${esc(revision.note || revision.action)}${revision.requestId ? ` · ${esc(revision.requestId)}` : ""}</p>${planningSnapshotHtml(revision.planning, budget.year, budget.revisions[index - 1]?.planning)}</details>`).join("") || '<p class="muted">Nessuna revisione approvata.</p>'}</div></details></section>
    <section class="panel" aria-label="Iter del budget"><details id="budget-approval-events" open><summary class="panel-title">Iter del budget (${budget.workflowEvents.length})</summary><div class="workflow-history-body">${budget.workflowEvents.length ? eventsHtml(budget.workflowEvents) : '<p class="muted">Nessuna decisione registrata.</p>'}</div></details></section>`;
}

const eventLabels = { submit: "Invio in approvazione", approve: "Approvazione", reject: "Rifiuto", withdraw: "Ritiro in bozza", reopen: "Riapertura bozza", edit: "Modifica bozza", create: "Creazione bozza" };
function eventsHtml(events) {
  return `<ul class="workflow-events">${events.map((event) => `<li>${esc(date(event.at))} · ${esc(event.actor)} · ${esc(eventLabels[event.action] || event.action)}${event.note ? ` · ${esc(event.note)}` : ""}</li>`).join("")}</ul>`;
}

export function requestHistoryHtml(budget, requests, search = "") {
  const filtered = requests.filter((request) => request.budgetId === budget.id &&
    `${request.id} ${request.reason} ${request.status} ${request.year}`.toLocaleLowerCase("it-IT").includes(search.trim().toLocaleLowerCase("it-IT")));
  return filtered.map((request) => {
    const button = (command, label, primary) => action("request", request.id, command, label, primary);
    const editable = request.status === "Bozza";
    const pending = request.status === "In approvazione";
    const total = request.changes.reduce((sum, change) => sum + Math.round(change.amount * 100), 0) / 100;
    const actions = editable ? button("edit", "Modifica") + button("delete", "Elimina") + (budget.isOfficial ? button("submit", "Invia in approvazione", true) : "")
      : pending ? button("withdraw", "Ritira") + button("reject", "Respingi") + (budget.isOfficial ? button("approve", "Approva", true) : "") : "";
    const details = (request.rows || []).map((row) => `<tr><td>${esc(row.code)}</td><td>${esc(row.name)}</td>${row.values.map((value, month) => `<td class="num${request.changes.some((change) => change.levelId === row.id && change.month === month) ? " history-changed" : ""}">${euroCents.format(value)}</td>`).join("")}</tr>`).join("");
    return `<article class="request-card"><div class="workflow-heading"><strong>${esc(request.id)}</strong>${badge(request.status)}<span>Anno ${esc(request.year)} · Variazione ${euroCents.format(total)}</span>${actions}</div><p>${esc(request.reason)}</p><p class="muted">${esc(date(request.createdAt))} · ${esc(request.createdBy)}</p><details><summary>Dettaglio variazioni e tabella proposta</summary><div class="table-wrap"><table><thead><tr><th>Voce</th><th>Anno</th><th>Mese</th><th>Variazione</th></tr></thead><tbody>${request.changes.map((change) => {
      const row = planningRows(budget.planning).find((item) => item.id === change.levelId);
      return `<tr><td>${esc(row?.name || change.levelId)}</td><td>${change.year}</td><td>${months[change.month]}</td><td class="num">${euroCents.format(change.amount)}</td></tr>`;
    }).join("")}</tbody></table></div><div class="table-wrap"><table><thead><tr><th>Codice</th><th>Descrizione</th>${months.map((month) => `<th>${month}</th>`).join("")}</tr></thead><tbody>${details}</tbody></table></div></details><details><summary>Iter della richiesta</summary>${eventsHtml(request.events)}</details></article>`;
  }).join("") || '<p class="muted">Nessuna rettifica corrisponde ai filtri.</p>';
}
