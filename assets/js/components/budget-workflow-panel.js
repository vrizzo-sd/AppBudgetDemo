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

export function revisionHistoryHtml(budget, expanded = new Set()) {
  return `<div id="budget-revisions" class="workflow-history-body">${budget.revisions.map((revision, index) => `<details class="monthly-history-entry" data-revision-number="${revision.number}" ${expanded.has(revision.number) ? "open" : ""}><summary>Revisione ${revision.number} · ${esc(date(revision.at))} · ${esc(revision.actor)} · ${euroCents.format(planningTotal(revision.planning))}</summary><p>${esc(revision.note || revision.action)}${revision.requestId ? ` · ${esc(revision.requestId)}` : ""}</p>${planningSnapshotHtml(revision.planning, budget.year, budget.revisions[index - 1]?.planning)}</details>`).join("") || '<p class="muted">Nessuna revisione approvata.</p>'}</div>`;
}

export function workflowIterHtml(budget, request = null) {
  const events = request ? request.events : budget.workflowEvents;
  return `<p class="iter-context"><strong>${request ? "Iter della rettifica" : "Iter del budget"}</strong><br>${request ? esc(request.id) : `${esc(budget.name)} · V${budget.version}`}</p>${events.length ? eventsHtml(events) : '<p class="muted">Nessuna decisione registrata.</p>'}`;
}

const eventLabels = { submit: "Invio in approvazione", approve: "Approvazione", reject: "Rifiuto", withdraw: "Ritiro in bozza", reopen: "Riapertura bozza", edit: "Modifica bozza", create: "Creazione bozza" };
function eventsHtml(events) {
  return `<ul class="workflow-events">${events.map((event) => `<li>${esc(date(event.at))} · ${esc(event.actor)} · ${esc(eventLabels[event.action] || event.action)}${event.note ? ` · ${esc(event.note)}` : ""}</li>`).join("")}</ul>`;
}

function dateKey(value) {
  const day = new Date(value);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

export function filterRequests(budget, requests, { search = "", status = "all", from = "", to = "" } = {}) {
  const term = search.trim().toLocaleLowerCase("it-IT");
  return requests.filter((request) => request.budgetId === budget.id &&
    (status === "all" || request.status === status) &&
    (!from || dateKey(request.createdAt) >= from) && (!to || dateKey(request.createdAt) <= to) &&
    `${request.id} ${request.reason} ${request.status} ${request.year} ${(request.rows || []).map((row) => `${row.code} ${row.name}`).join(" ")}`.toLocaleLowerCase("it-IT").includes(term));
}

function requestActionsHtml(budget, request) {
  const button = (command, label, primary) => action("request", request.id, command, label, primary);
  const editable = request.status === "Bozza";
  const pending = request.status === "In approvazione";
  const revision = budget.revisions.find((item) => item.requestId === request.id);
  const actions = editable ? (budget.isOfficial ? button("edit", "Modifica") : "") + button("delete", "Elimina") + (budget.isOfficial ? button("submit", "Invia in approvazione", true) : "")
    : pending ? button("withdraw", "Ritira") + button("reject", "Respingi") + (budget.isOfficial ? button("approve", "Approva", true) : "") : "";
  return actions + (revision ? `<button type="button" class="btn small" data-open-revision="${revision.number}" data-revision-request="${esc(request.id)}">Revisione ${revision.number}</button>` : "");
}

export function requestHistoryHtml(budget, requests, selectedId = null) {
  return `<div class="table-wrap"><table class="request-table" aria-label="Rettifiche del budget"><thead><tr><th>Richiesta</th><th>Data</th><th>Motivazione</th><th class="num">Variazione</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>${requests.map((request) => {
    const total = request.changes.reduce((sum, change) => sum + Math.round(change.amount * 100), 0) / 100;
    return `<tr data-request-row="${esc(request.id)}" tabindex="0" class="${request.id === selectedId ? "request-selected" : ""}" ${request.id === selectedId ? 'aria-current="true"' : ""}><td class="request-number"><button class="request-select" type="button" data-select-request="${esc(request.id)}" aria-label="Dettagli ${esc(request.id)}">${esc(request.id)}</button></td><td>${esc(date(request.createdAt))}</td><td class="request-reason">${esc(request.reason)}</td><td class="num">${total > 0 ? "+" : ""}${euroCents.format(total)}</td><td>${badge(request.status)}</td><td class="request-actions">${requestActionsHtml(budget, request)}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="center muted">Nessuna rettifica corrisponde ai filtri.</td></tr>'}</tbody></table></div>`;
}

export function requestDetailHtml(budget, request) {
  const detailRows = request.changes.map((change) => {
    const snapshotRow = request.rows.find((row) => row.id === change.levelId);
    const row = snapshotRow || planningRows(budget.planning).find((item) => item.id === change.levelId);
    const after = snapshotRow?.values[change.month];
    const before = after == null ? null : (Math.round(after * 100) - Math.round(change.amount * 100)) / 100;
    return `<tr><td>${esc(row ? `${row.code} · ${row.name}` : change.levelId)}</td><td>${change.year}</td><td>${months[change.month]}</td><td class="num">${before == null ? "—" : euroCents.format(before)}</td><td class="num">${change.amount > 0 ? "+" : ""}${euroCents.format(change.amount)}</td>${after == null ? '<td class="num">—</td>' : variationCellHtml(after, before)}</tr>`;
  }).join("");
  return `<div class="request-detail-heading"><strong>Dettaglio ${esc(request.id)}</strong>${badge(request.status)}</div><p>${esc(request.reason)}</p><p class="muted">${esc(date(request.createdAt))} · ${esc(request.createdBy)}</p><div class="table-wrap"><table aria-label="Variazioni della rettifica"><thead><tr><th>Voce</th><th>Anno</th><th>Mese</th><th>Precedente</th><th>Variazione</th><th>Proposto</th></tr></thead><tbody>${detailRows}</tbody></table></div>`;
}
