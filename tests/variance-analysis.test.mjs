import test from "node:test";
import assert from "node:assert/strict";
import { buildVarianceTree, comparisonPeriods } from "../assets/js/core/variance-analysis.js";
import { varianceRowsHtml } from "../assets/js/components/variance-table.js";
import { clone } from "../assets/js/core/formatters.js";
import { copyBudgetWithNextVersion } from "../assets/js/core/budget-versioning.js";
import { transitionBudget } from "../assets/js/core/budget-workflow.js";
import { fixture, scenario, extendedScenarios } from "./helpers/workflow-fixtures.mjs";

const data = (months = [110, ...Array(11).fill(0)], code = "R", year = 2027) =>
  [{ code, year, months }];
const tree = (budget, revision = 0, actuals = data(), from = "2027-01", to = "2027-12") =>
  buildVarianceTree(budget, revision, from, to, actuals);

test("revisioni storiche escludono rettifiche successive e la consultazione non muta lo stato", () => {
  const state = scenario().at(-1), budget = state.budgets[0], before = clone(state);
  const initial = tree(budget, 0), updated = tree(budget, 1);
  assert.deepEqual([initial.initial, initial.adjustment, initial.updated, initial.actual, initial.delta, initial.percent], [100, 0, 100, 110, 10, 10]);
  assert.deepEqual([updated.initial, updated.adjustment, updated.updated, updated.actual, updated.delta], [100, 5, 105, 110, 5]);
  assert.ok(Math.abs(updated.percent - 5 / 105 * 100) < 1e-10);
  assert.deepEqual(state, before);
});

test("richieste in bozza e pendenti non entrano nel confronto", () => {
  for (const index of [3, 4]) assert.equal(tree(scenario()[index].budgets[0]).updated, 100);
});

test("il periodo filtra base, aggiornato e consuntivo sugli stessi mesi", () => {
  const budget = scenario().at(-1).budgets[0];
  const result = tree(budget, 1, data([110, 25, ...Array(10).fill(0)]), "2027-02", "2027-02");
  assert.deepEqual([result.initial, result.adjustment, result.updated, result.actual, result.delta, result.percent], [0, 0, 0, 25, 25, null]);
});

test("zero esplicito disponibile, valori negativi con segno e percentuale su zero non calcolabile", () => {
  const budget = scenario()[2].budgets[0];
  const zero = tree(budget, 0, data(Array(12).fill(0)));
  assert.deepEqual([zero.actual, zero.delta, zero.percent], [0, -100, -100]);
  const february = tree(budget, 0, data(Array(12).fill(0)), "2027-02", "2027-02");
  assert.deepEqual([february.actual, february.delta, february.percent], [0, 0, null]);
});

test("totali in centesimi e percentuali ponderate sugli aggregati, senza sommare i livelli", () => {
  const state = fixture(), budget = state.budgets[0], parent = budget.planning.level1[0];
  parent.budget = budget.planning.totalBudget = 400;
  const first = budget.planning.level2[0]; first.totalPercent = 25;
  budget.planning.level2.push({ ...clone(first), id: "second", code: "S", totalPercent: 75, months: [300, ...Array(11).fill(0)] });
  for (const action of ["submit", "approve"]) transitionBudget(budget, action, [budget], []);
  const result = tree(budget, 0, [...data([110.01, ...Array(11).fill(0)]), ...data([300.02, ...Array(11).fill(0)], "S")]);
  assert.equal(result.actual, 410.03);
  assert.equal(result.delta, 10.03);
  assert.equal(result.percent, 10.03 / 400 * 100);
  assert.equal(result.children[0].actual, 410.03);
  assert.notEqual(result.percent, result.children[0].children.reduce((sum, row) => sum + row.percent, 0));
  const partial = tree(budget, 0, data([110.01, ...Array(11).fill(0)]));
  assert.equal(partial.actual, null);
  assert.equal(partial.children[0].actual, null);
  assert.equal(partial.children[0].children[0].actual, 110.01);
  assert.equal(partial.children[0].children[1].actual, null);
});

test("un mese o un figlio mancante non viene sostituito con zero né sommato come totale completo", () => {
  const budget = scenario()[2].budgets[0];
  const missing = tree(budget, 0, data([110]));
  assert.equal(missing.actual, null);
  assert.equal(missing.delta, null);
  assert.equal(missing.children[0].children[0].actual, null);
  assert.equal(tree(budget, 0, []).actual, null);
  assert.equal(tree(budget, 0, data([110]), "2027-01", "2027-01").actual, 110);
});

test("investimento a un livello confronta anche periodi su più anni", () => {
  const state = extendedScenarios()[1].at(-1), budget = state.budgets[0];
  const actuals = [...data([110, ...Array(11).fill(0)], "P", 2027), ...data([120, ...Array(11).fill(0)], "P", 2028)];
  const result = tree(budget, 1, actuals, "2027-01", "2028-12");
  assert.deepEqual([result.initial, result.adjustment, result.updated, result.actual, result.delta], [200, 1.55, 201.55, 230, 28.45]);
  assert.equal(result.children.length, 1);
  assert.equal(result.children[0].children.length, 0);
});

test("la nuova versione usa la base consolidata e mantiene il medesimo consuntivo anche con ID rigenerati", () => {
  const state = scenario().at(-1), original = state.budgets[0];
  let counter = 0;
  const copied = copyBudgetWithNextVersion(state.budgets, original, () => String(++counter), state.adjustments);
  state.budgets.push(copied);
  for (const action of ["submit", "approve"]) transitionBudget(copied, action, state.budgets, state.adjustments);
  assert.notEqual(copied.planning.level2[0].id, original.planning.level2[0].id);
  const result = tree(copied);
  assert.deepEqual([result.initial, result.adjustment, result.updated, result.actual], [105, 0, 105, 110]);
  assert.equal(tree(original, 1).actual, result.actual);
});

test("bozze, revisioni inesistenti e periodi invalidi vengono rifiutati", () => {
  assert.throws(() => tree(fixture().budgets[0]), /approvata/);
  const budget = scenario()[2].budgets[0];
  assert.throws(() => tree(budget, 5), /approvata/);
  assert.throws(() => comparisonPeriods("2027-03", "2027-01"), /iniziale/);
  assert.throws(() => comparisonPeriods("", "2027-01"), /Seleziona/);
  assert.throws(() => comparisonPeriods("2027-13", "2027-13"), /Seleziona/);
  assert.throws(() => tree(budget, 0, data(), "2027-01", "2028-01"), /ordinario/);
});

test("tabella espandibile neutra, importi italiani con segno e testi escapati", () => {
  const root = tree(scenario()[2].budgets[0]); root.name = '<img src=x onerror="alert(1)">';
  const expanded = new Set([root.id, root.children[0].id]);
  const html = varianceRowsHtml(root, expanded);
  assert.equal((html.match(/<tr /g) || []).length, 3);
  assert.equal((varianceRowsHtml(root, new Set()).match(/<tr /g) || []).length, 1);
  assert.match(html, /\+10,00/);
  assert.match(html, /\+10,00%/);
  assert.match(html, /aria-expanded="true"/);
  assert.ok(!html.includes("<img"));
  assert.ok(!/variation-increase|variation-decrease|favorevole|sfavorevole/.test(html));
});

