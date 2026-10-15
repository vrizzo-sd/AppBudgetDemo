import { clone } from "./formatters.js";
import { planningValidation, planningYearMonths, setPlanningMonthAmount } from "./budget-hierarchy.js";

export const ACTOR = "Utente demo";
export const cents = (value) => Math.round(Number(value) * 100);
export const planningRows = (planning) => planning.mode === "single-level" ? planning.level1 : planning.level2;
const key = (value) => String(value || "").trim().toLocaleUpperCase("it-IT");
export const sameBudgetFamily = (a, b) => a.year === b.year && key(a.name) === key(b.name) &&
  key(a.associatedStructure) === key(b.associatedStructure) && a.type === b.type;
export const canEditBudget = (budget) => budget.workflowState === "Bozza";

export function initializeWorkflow(budgets, requests, adjustments) {
  budgets.forEach((budget) => {
    // Existing active flags do not constitute an approval.
    budget.workflowState ||= "Bozza";
    budget.isOfficial ??= false;
    budget.revisions ||= [];
    budget.workflowEvents ||= [];
  });
  requests.forEach((request) => {
    const records = adjustments.filter((item) => item.requestId === request.id);
    request.status ||= records[0]?.status || "In approvazione";
    request.createdBy ||= ACTOR;
    request.events ||= [];
    request.changes.forEach((change) => {
      const record = records.find((item) => item.rowId === change.levelId && item.month === change.month);
      change.year ??= request.year;
      change.amount ??= record?.amount ?? (cents(change.after) - cents(change.before)) / 100;
    });
  });
}

export function approvedDelta(budget, adjustments, rowId, year, month) {
  return adjustments.filter((item) => item.scope === "planning" && item.budgetId === budget.id &&
    item.rowId === rowId && Number(item.year ?? budget.year) === Number(year) &&
    item.month === month && item.status === "Approvata")
    .reduce((sum, item) => sum + cents(item.amount), 0) / 100;
}

export function effectivePlanning(budget, adjustments) {
  const planning = clone(budget.planning);
  planning.budgetYear = budget.year;
  for (const level of planningRows(planning)) {
    const years = new Set([budget.year, ...Object.keys(level.yearMonths || {}).map(Number)]);
    adjustments.filter((item) => item.scope === "planning" && item.budgetId === budget.id && item.rowId === level.id)
      .forEach((item) => years.add(Number(item.year ?? budget.year)));
    for (const year of years) {
      const values = planningYearMonths(level, year, budget.year);
      for (let month = 0; month < 12; month += 1) {
        const delta = approvedDelta(budget, adjustments, level.id, year, month);
        if (delta && !setPlanningMonthAmount(planning, level, year, month, (cents(values[month]) + cents(delta)) / 100)) {
          throw new Error("Le rettifiche approvate producono un importo non valido.");
        }
      }
    }
  }
  return planning;
}

export function assertBalanced(planning) {
  const levels = planningRows(planning);
  if (!planning.level1.length || !levels.length || !planningValidation(planning).valid) {
    throw new Error("Il budget non quadra: completa livelli, percentuali e pianificazione mensile prima dell’invio.");
  }
  if (planning.level2.some((level) => !planning.level1.some((parent) => parent.id === level.parentId)) ||
    planning.mode !== "single-level" && planning.level1.some((parent) => !planning.level2.some((level) => level.parentId === parent.id))) {
    throw new Error("Completa i collegamenti tra livelli padre e figlio prima dell’invio.");
  }
  for (const level of [...planning.level1, ...planning.level2]) {
    if (!Number.isFinite(level.totalPercent) || level.totalPercent < 0 ||
      level.budget !== undefined && (!Number.isFinite(level.budget) || level.budget < 0)) {
      throw new Error("Importi o percentuali non validi.");
    }
    const values = [...(level.months || []), ...Object.values(level.yearMonths || {}).flat()];
    if (values.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0 || Math.abs(Number(value) * 100 - cents(value)) > 1e-6)) {
      throw new Error("Gli importi devono essere non negativi e avere al massimo due decimali.");
    }
  }
}

function event(action, note = "") {
  return { action, note, actor: ACTOR, at: new Date().toISOString() };
}

export function transitionBudget(budget, action, budgets, adjustments, note = "") {
  const state = budget.workflowState;
  if (action === "submit" && state === "Bozza") {
    assertBalanced(budget.planning);
    budget.workflowState = "In approvazione";
  } else if (action === "withdraw" && state === "In approvazione" || action === "reopen" && state === "Respinto") {
    budget.workflowState = "Bozza";
  } else if (action === "reject" && state === "In approvazione") {
    if (!note.trim()) throw new Error("Indica il motivo del rifiuto.");
    budget.workflowState = "Respinto";
  } else if (action === "approve" && state === "In approvazione") {
    assertBalanced(budget.planning);
    const planning = effectivePlanning(budget, adjustments);
    assertBalanced(planning);
    budgets.filter((item) => item.id !== budget.id && sameBudgetFamily(item, budget)).forEach((item) => {
      item.isOfficial = false;
      item.state = "Disattivo";
    });
    budget.workflowState = "Approvato";
    budget.isOfficial = true;
    budget.state = "Attivo";
    budget.revision = 0;
    budget.baseSnapshot = clone(budget.planning);
    budget.revisions = [{ number: 0, ...event("Approvazione iniziale"), planning }];
  } else throw new Error("Operazione non disponibile nello stato attuale del budget.");
  budget.workflowEvents.push(event(action, note));
}

export function validateRequest(budget, request, adjustments, requests) {
  if (budget.workflowState !== "Approvato" || !budget.isOfficial) {
    throw new Error("Le nuove rettifiche richiedono la versione approvata e ufficiale del budget.");
  }
  if (!request.reason.trim() || !request.changes.length) throw new Error("Inserisci almeno una variazione e la motivazione.");
  const seen = new Set();
  for (const change of request.changes) {
    const level = planningRows(budget.planning).find((item) => item.id === change.levelId);
    const cell = `${change.levelId}:${change.year}:${change.month}`;
    if (!level || seen.has(cell) || !Number.isInteger(change.month) || change.month < 0 || change.month > 11 ||
      !Number.isInteger(change.year) || change.year < budget.year || change.year > 2100 ||
      budget.type !== "Investimento" && change.year !== budget.year || level.monthlyActive === false) {
      throw new Error("La richiesta contiene una voce, un anno o un mese non valido.");
    }
    seen.add(cell);
    if (requests.some((other) => other.id !== request.id && other.budgetId === budget.id &&
      ["Bozza", "In approvazione"].includes(other.status) && other.changes.some((item) =>
        `${item.levelId}:${item.year}:${item.month}` === cell))) {
      throw new Error("Esiste già una rettifica in bozza o in approvazione su una delle celle selezionate.");
    }
    const current = approvedDelta(budget, adjustments, level.id, change.year, change.month);
    const base = planningYearMonths(level, change.year, budget.year)[change.month];
    if (!Number.isFinite(change.amount) || cents(change.amount) === 0 || Math.abs(change.amount * 100 - cents(change.amount)) > 1e-6 ||
      cents(change.before) !== cents(current) || cents(change.after) !== cents(current) + cents(change.amount)) {
      throw new Error("I valori ufficiali sono cambiati: riapri la rettifica e aggiorna la proposta.");
    }
    if (cents(base) + cents(change.after) < 0) throw new Error("Una rettifica non può rendere negativo il budget di un mese.");
  }
}

export function requestRecords(request, budget) {
  return request.changes.map((change, index) => {
    const row = planningRows(budget.planning).find((item) => item.id === change.levelId);
    return { id: `${request.id}-${index + 1}`, requestId: request.id, budgetId: request.budgetId,
      scope: "planning", rowId: change.levelId, rowLabel: `${row.code} · ${row.name}`,
      ...change, status: request.status, reason: request.reason, createdAt: request.createdAt };
  });
}

export function transitionRequest(budget, request, action, adjustments, requests, note = "") {
  if (action === "submit" && request.status === "Bozza") {
    validateRequest(budget, request, adjustments, requests);
    request.status = "In approvazione";
  } else if (action === "withdraw" && request.status === "In approvazione") {
    request.status = "Bozza";
  } else if (action === "reject" && request.status === "In approvazione") {
    if (!note.trim()) throw new Error("Indica il motivo del rifiuto.");
    request.status = "Respinta";
  } else if (action === "approve" && request.status === "In approvazione") {
    validateRequest(budget, request, adjustments, requests);
    const proposed = adjustments.map((item) => item.requestId === request.id ? { ...item, status: "Approvata" } : item);
    const planning = effectivePlanning(budget, proposed);
    assertBalanced(planning);
    request.status = "Approvata";
    budget.revision += 1;
    budget.revisions.push({ number: budget.revision, requestId: request.id,
      ...event("Rettifica approvata", request.reason), planning });
  } else throw new Error("Operazione non disponibile nello stato attuale della rettifica.");
  request.events.push(event(action, note));
  adjustments.filter((item) => item.requestId === request.id).forEach((item) => { item.status = request.status; });
}
