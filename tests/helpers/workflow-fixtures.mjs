import { clone } from "../../assets/js/core/formatters.js";
import { initializeWorkflow, transitionBudget, transitionRequest, requestRecords } from "../../assets/js/core/budget-workflow.js";
import { copyBudgetWithNextVersion } from "../../assets/js/core/budget-versioning.js";

export function fixture(investment = false) {
  const months = [100, ...Array(11).fill(0)];
  const parent = { id: "parent", code: "P", name: "Padre", budget: 100, totalPercent: 100, months, monthlyActive: true };
  const budget = { id: "budget", year: 2027, name: "TEST", version: 1, revision: 0, frequency: "Annuale", type: investment ? "Investimento" : "Ordinario",
    state: "Disattivo", associatedStructure: "Struttura 1", children: [{ id: "child", code: "NEW", name: "Test", state: "Bozza" }],
    planning: { mode: investment ? "single-level" : "two-level", budgetYear: 2027, totalBudget: 100, level1: [parent],
      level2: investment ? [] : [{ id: "row", parentId: "parent", parentCode: "P", code: "R", name: "Riga", totalPercent: 100, months: clone(months), monthlyActive: true }] } };
  const state = { budgets: [budget], adjustments: [], monthlyHistory: [], capexComponents: [], ordinaryRows: { cost: [], revenue: [] }, investmentRows: { cost: [], revenue: [] } };
  initializeWorkflow(state.budgets, state.monthlyHistory, state.adjustments);
  return state;
}

export function requestFor(state, id = "RET-1", changes = [{ levelId: "row", year: 2027, month: 0, before: 0, after: 5, amount: 5 }]) {
  return { id, budgetId: state.budgets[0].id, year: changes[0].year, reason: "Variazione di prova", status: "Bozza", createdAt: "2026-10-15T12:00:00.000Z", createdBy: "Utente demo", events: [], changes, rows: [] };
}

export function saveRequest(state, request) {
  state.monthlyHistory.unshift(request);
  state.adjustments.push(...requestRecords(request, state.budgets[0]));
}

export function scenario() {
  const state = fixture();
  const states = [clone(state)];
  transitionBudget(state.budgets[0], "submit", state.budgets, state.adjustments);
  states.push(clone(state));
  transitionBudget(state.budgets[0], "approve", state.budgets, state.adjustments);
  states.push(clone(state));
  const request = requestFor(state);
  saveRequest(state, request);
  states.push(clone(state));
  transitionRequest(state.budgets[0], request, "submit", state.adjustments, state.monthlyHistory);
  states.push(clone(state));
  transitionRequest(state.budgets[0], request, "approve", state.adjustments, state.monthlyHistory);
  states.push(clone(state));
  return states;
}

export function extendedScenarios() {
  const versions = scenario();
  const state = clone(versions.at(-1));
  const pending = requestFor(state, "PENDING-OLD", [{ levelId: "row", year: 2027, month: 1, before: 0, after: 10, amount: 10 }]);
  saveRequest(state, pending); versions.push(clone(state));
  transitionRequest(state.budgets[0], pending, "submit", state.adjustments, state.monthlyHistory); versions.push(clone(state));
  let counter = 0;
  const copied = copyBudgetWithNextVersion(state.budgets, state.budgets[0], () => `${++counter}`, state.adjustments);
  state.budgets.push(copied); versions.push(clone(state));
  for (const action of ["submit", "approve"]) { transitionBudget(copied, action, state.budgets, state.adjustments); versions.push(clone(state)); }
  transitionRequest(state.budgets[0], pending, "withdraw", state.adjustments, state.monthlyHistory); versions.push(clone(state));

  const investment = fixture(true), budget = investment.budgets[0];
  budget.planning.level1[0].yearMonths = { 2028: [100, ...Array(11).fill(0)] };
  budget.planning.level1[0].budget = budget.planning.totalBudget = 200;
  const multiyear = [clone(investment)];
  for (const action of ["submit", "approve"]) { transitionBudget(budget, action, investment.budgets, []); multiyear.push(clone(investment)); }
  const request = requestFor(investment, "NEXT-YEAR", [{ levelId: "parent", year: 2028, month: 0, before: 0, after: 1.55, amount: 1.55 }]);
  saveRequest(investment, request); multiyear.push(clone(investment));
  for (const action of ["submit", "approve"]) { transitionRequest(budget, request, action, investment.adjustments, investment.monthlyHistory); multiyear.push(clone(investment)); }
  return [versions, multiyear];
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/workflow-fixtures.mjs")) console.log(JSON.stringify(process.argv.includes("--extended") ? extendedScenarios() : scenario()));
