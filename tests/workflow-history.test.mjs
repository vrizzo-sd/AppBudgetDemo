import test from "node:test";
import assert from "node:assert/strict";
import { clone } from "../assets/js/core/formatters.js";
import { filterRequests, requestHistoryHtml, requestDetailHtml, workflowIterHtml } from "../assets/js/components/budget-workflow-panel.js";
import { fixture, requestFor, scenario } from "./helpers/workflow-fixtures.mjs";

test("ricerca, stato e intervallo date mantengono le richieste nel budget selezionato", () => {
  const state = fixture(), budget = state.budgets[0];
  const first = requestFor(state);
  first.rows = [{ id: "row", code: "R", name: "Produzione Grana", values: [105, ...Array(11).fill(0)] }];
  const other = { ...clone(first), id: "OTHER", budgetId: "other-budget" };
  const approved = { ...clone(first), id: "APPROVED", status: "Approvata" };
  assert.deepEqual(filterRequests(budget, [first, other, approved], { search: "grana", status: "Bozza", from: "2026-10-15", to: "2026-10-15" }).map((item) => item.id), [first.id]);
  assert.equal(filterRequests(budget, [first], { to: "2026-10-14" }).length, 0);
  assert.equal(filterRequests(budget, [first], { from: "2026-10-16" }).length, 0);
});

test("una rettifica approvata collega la propria revisione e non espone comandi di modifica", () => {
  const state = scenario().at(-1), request = state.monthlyHistory[0];
  const html = requestHistoryHtml(state.budgets[0], [request], request.id);
  assert.match(html, /data-open-revision="1"/);
  assert.match(html, /data-revision-request="RET-1"/);
  assert.match(html, /request-selected/);
  assert.doesNotMatch(html, /data-workflow-action="(?:edit|delete|approve|reject)"/);
});

test("una richiesta pendente su versione precedente resta ritirabile e respingibile", () => {
  const state = scenario()[4]; state.budgets[0].isOfficial = false;
  const html = requestHistoryHtml(state.budgets[0], state.monthlyHistory);
  assert.match(html, /data-workflow-action="withdraw"/);
  assert.match(html, /data-workflow-action="reject"/);
  assert.doesNotMatch(html, /data-workflow-action="approve"/);
});

test("il dettaglio mostra valori ufficiali prima e dopo, distinti dalle variazioni cumulate", () => {
  const state = fixture(), request = requestFor(state);
  Object.assign(request.changes[0], { before: 5, after: 10, amount: 5 });
  request.rows = [{ id: "row", code: "R", name: "Riga", values: [110, ...Array(11).fill(0)] }];
  const html = requestDetailHtml(state.budgets[0], request);
  assert.match(html, /105,00/);
  assert.match(html, /110,00/);
  assert.match(html, /\+5,00/);
});

test("l'iter passa dal budget alla richiesta conservando autore e motivo della decisione", () => {
  const state = scenario()[4], request = state.monthlyHistory[0];
  request.events.push({ actor: "Utente demo", at: request.createdAt, action: "reject", note: "Preventivo da correggere" });
  assert.match(workflowIterHtml(state.budgets[0]), /Iter del budget/);
  const html = workflowIterHtml(state.budgets[0], request);
  assert.match(html, /Iter della rettifica/);
  assert.match(html, /Utente demo/);
  assert.match(html, /Preventivo da correggere/);
});

test("motivazioni e descrizioni restano testo in tabella e nel dettaglio", () => {
  const state = fixture(), request = requestFor(state);
  request.reason = '<img src=x onerror="alert(1)">';
  request.rows = [{ id: "row", code: "R", name: "<script>test</script>", values: [105, ...Array(11).fill(0)] }];
  const html = requestHistoryHtml(state.budgets[0], [request]) + requestDetailHtml(state.budgets[0], request);
  assert.doesNotMatch(html, /<img |<script>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
});
