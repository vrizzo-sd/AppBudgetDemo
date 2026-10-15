import test from "node:test";
import assert from "node:assert/strict";
import { clone } from "../assets/js/core/formatters.js";
import { approvedDelta, effectivePlanning, transitionBudget, transitionRequest, validateRequest, initializeWorkflow } from "../assets/js/core/budget-workflow.js";
import { copyBudgetWithNextVersion } from "../assets/js/core/budget-versioning.js";
import { fixture, requestFor, saveRequest, scenario } from "./helpers/workflow-fixtures.mjs";
import { planningSnapshotHtml } from "../assets/js/components/budget-workflow-panel.js";

const approved = () => scenario()[2];
test("una bozza incompleta non viene inviata e non crea revisioni", () => {
  const state = fixture();
  state.budgets[0].planning.level2[0].months[0] = 20;
  assert.throws(() => transitionBudget(state.budgets[0], "submit", state.budgets, []), /non quadra/);
  assert.equal(state.budgets[0].workflowState, "Bozza");
  assert.equal(state.budgets[0].revisions.length, 0);
});
test("approvazione iniziale crea R0 e distingue ufficiale da attivo legacy", () => {
  const state = fixture();
  assert.equal(state.budgets[0].isOfficial, false);
  assert.throws(() => transitionBudget(state.budgets[0], "approve", state.budgets, []));
  const done = approved().budgets[0];
  assert.equal(done.revision, 0);
  assert.equal(done.isOfficial, true);
  assert.deepEqual(done.baseSnapshot, done.planning);
});
test("ritiro e rifiuto del budget consentono riapertura senza revisioni", () => {
  const state = fixture(), budget = state.budgets[0];
  for (const action of ["submit", "withdraw", "submit"]) transitionBudget(budget, action, state.budgets, []);
  assert.throws(() => transitionBudget(budget, "reject", state.budgets, []), /motivo/);
  transitionBudget(budget, "reject", state.budgets, [], "Da correggere");
  transitionBudget(budget, "reopen", state.budgets, []);
  assert.equal(budget.workflowState, "Bozza");
  assert.equal(budget.workflowEvents.length, 5);
});
test("richieste in bozza e pendenti non cambiano i valori ufficiali", () => {
  const state = scenario();
  for (const index of [3, 4]) assert.equal(effectivePlanning(state[index].budgets[0], state[index].adjustments).totalBudget, 100);
});
test("rettifica approvata aggiorna livelli e percentuali una volta sola, conservando base e R0", () => {
  const states = scenario(), done = states[5], budget = done.budgets[0];
  assert.equal(budget.revision, 1);
  assert.equal(budget.planning.level2[0].months[0], 100);
  assert.equal(budget.revisions[0].planning.totalBudget, 100);
  assert.equal(budget.revisions[1].planning.totalBudget, 105);
  assert.equal(effectivePlanning(budget, done.adjustments).level1[0].budget, 105);
  assert.equal(effectivePlanning(budget, done.adjustments).level2[0].totalPercent, 100);
  assert.throws(() => transitionRequest(budget, done.monthlyHistory[0], "approve", done.adjustments, done.monthlyHistory));
});
test("una richiesta con più celle genera una sola revisione e può spostare importi", () => {
  const state = approved(), budget = state.budgets[0];
  const request = requestFor(state, "TRANSFER", [
    { levelId: "row", year: 2027, month: 0, before: 0, after: -50, amount: -50 },
    { levelId: "row", year: 2027, month: 1, before: 0, after: 50, amount: 50 },
  ]);
  saveRequest(state, request);
  for (const action of ["submit", "approve"]) transitionRequest(budget, request, action, state.adjustments, state.monthlyHistory);
  assert.equal(budget.revision, 1);
  assert.deepEqual(budget.revisions[1].planning.level2[0].months.slice(0, 2), [50, 50]);
  assert.equal(budget.revisions[1].planning.totalBudget, 100);
});
test("sovrapposizioni e budget mensili negativi sono bloccati prima dell'invio", () => {
  const state = approved(), budget = state.budgets[0], request = requestFor(state);
  const negative = clone(request); negative.changes[0].amount = negative.changes[0].after = -101;
  assert.throws(() => validateRequest(budget, negative, [], []), /negativo/);
  saveRequest(state, request);
  const other = requestFor(state, "RET-2");
  assert.throws(() => validateRequest(budget, other, [], state.monthlyHistory), /già/);
});
test("un rifiuto richiede motivazione, resta nello storico e non cambia R0", () => {
  const state = scenario()[4], request = state.monthlyHistory[0], budget = state.budgets[0];
  assert.throws(() => transitionRequest(budget, request, "reject", state.adjustments, state.monthlyHistory));
  transitionRequest(budget, request, "reject", state.adjustments, state.monthlyHistory, "Non autorizzata");
  assert.equal(request.status, "Respinta");
  assert.equal(request.events.at(-1).note, "Non autorizzata");
  assert.equal(budget.revision, 0);
});
test("una richiesta ritirata torna modificabile e non perde l'iter", () => {
  const state = scenario()[4], request = state.monthlyHistory[0];
  transitionRequest(state.budgets[0], request, "withdraw", state.adjustments, state.monthlyHistory);
  assert.equal(request.status, "Bozza");
  assert.equal(request.events.at(-1).action, "withdraw");
});
test("una copia consolida rettifiche approvate, rigenera riferimenti e riparte da R0", () => {
  const state = scenario()[5];
  let id = 0;
  const copy = copyBudgetWithNextVersion(state.budgets, state.budgets[0], () => String(++id), state.adjustments);
  assert.equal(copy.version, 2);
  assert.equal(copy.revision, 0);
  assert.equal(copy.workflowState, "Bozza");
  assert.equal(copy.planning.level2[0].months[0], 105);
  assert.equal(copy.planning.level2[0].parentId, copy.planning.level1[0].id);
  assert.notEqual(copy.planning.level2[0].id, "row");
  assert.equal(effectivePlanning(copy, state.adjustments).totalBudget, 105);
  assert.equal(copy.revisions.length, 0);
  assert.equal(copy.baseSnapshot, undefined);
});
test("l'approvazione di V2 sostituisce l'ufficiale senza cancellare V1", () => {
  const state = approved(); let id = 0;
  const copy = copyBudgetWithNextVersion(state.budgets, state.budgets[0], () => String(++id));
  state.budgets.push(copy);
  for (const action of ["submit", "approve"]) transitionBudget(copy, action, state.budgets, []);
  assert.equal(state.budgets[0].isOfficial, false);
  assert.equal(state.budgets[0].workflowState, "Approvato");
  assert.equal(copy.isOfficial, true);
  assert.equal(state.budgets[0].revisions.length, 1);
});
test("l'investimento rettifica l'anno selezionato e conserva gli altri anni", () => {
  const state = fixture(true), budget = state.budgets[0];
  budget.planning.level1[0].yearMonths = { 2028: [100, ...Array(11).fill(0)] };
  budget.planning.level1[0].budget = budget.planning.totalBudget = 200;
  for (const action of ["submit", "approve"]) transitionBudget(budget, action, state.budgets, []);
  const request = requestFor(state, "MULTIYEAR", [{ levelId: "parent", year: 2028, month: 0, before: 0, after: 10.55, amount: 10.55 }]);
  saveRequest(state, request);
  for (const action of ["submit", "approve"]) transitionRequest(budget, request, action, state.adjustments, state.monthlyHistory);
  const planning = effectivePlanning(budget, state.adjustments);
  assert.equal(planning.level1[0].months[0], 100);
  assert.equal(planning.level1[0].yearMonths[2028][0], 110.55);
  assert.equal(planning.totalBudget, 210.55);
});
test("lo storno successivo conserva entrambe le revisioni e usa i centesimi", () => {
  const state = scenario()[5], budget = state.budgets[0];
  const request = requestFor(state, "STORNO", [{ levelId: "row", year: 2027, month: 0, before: 5, after: 0, amount: -5 }]);
  saveRequest(state, request);
  for (const action of ["submit", "approve"]) transitionRequest(budget, request, action, state.adjustments, state.monthlyHistory);
  assert.equal(approvedDelta(budget, state.adjustments, "row", 2027, 0), 0);
  assert.equal(budget.revision, 2);
  assert.deepEqual(budget.revisions.map((revision) => revision.planning.totalBudget), [100, 105, 100]);
});
test("le richieste obsolete non vengono approvate su valori modificati", () => {
  const state = scenario()[5], request = requestFor(state, "STALE");
  assert.throws(() => validateRequest(state.budgets[0], request, state.adjustments, []), /cambiati/);
});

test("lo storno si colora rispetto alla revisione precedente anche tornando al valore iniziale", () => {
  const budget = scenario()[5].budgets[0];
  const html = planningSnapshotHtml(budget.revisions[0].planning, 2027, budget.revisions[1].planning);
  assert.equal((html.match(/td class="num variation-decrease"/g) || []).length, 2);
  assert.match(html, /−5,00/);
  assert.doesNotMatch(planningSnapshotHtml(budget.revisions[0].planning, 2027), /variation-decrease/);
});

test("uno spostamento tra mesi evidenzia aumento e diminuzione ma lascia il totale invariato neutro", () => {
  const before = fixture().budgets[0].planning;
  const after = clone(before);
  after.level2[0].months[0] = after.level2[0].months[1] = 50;
  const html = planningSnapshotHtml(after, 2027, before);
  assert.equal((html.match(/td class="num variation-increase"/g) || []).length, 1);
  assert.equal((html.match(/td class="num variation-decrease"/g) || []).length, 1);
  assert.match(html, /\+50,00/);
  assert.match(html, /−50,00/);
});

test("i colori confrontano lo stesso anno dell'investimento e rispettano i centesimi", () => {
  const before = fixture(true).budgets[0].planning;
  before.level1[0].yearMonths = { 2028: [200, ...Array(11).fill(0)] };
  const after = clone(before);
  after.level1[0].yearMonths[2028][0] = 200.01;
  const html = planningSnapshotHtml(after, 2027, before);
  assert.equal((html.match(/td class="num variation-increase"/g) || []).length, 2);
  assert.match(html, /\+0,01/);
  assert.doesNotMatch(html, /\+100,01/);
});
