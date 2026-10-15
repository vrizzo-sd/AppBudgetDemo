import test from "node:test";
import assert from "node:assert/strict";
import { scenario, extendedScenarios } from "./helpers/workflow-fixtures.mjs";
import { buildVarianceTree } from "../assets/js/core/variance-analysis.js";
import { varianceChartData } from "../assets/js/core/variance-chart-data.js";
import { varianceChartsHtml, varianceChartScale } from "../assets/js/components/variance-charts.js";

const cents = (value) => Math.round(value * 100);
const makeData = (values = [110, 20, ...Array(10).fill(0)], from = "2027-01", to = "2027-12", revision = 1) => {
  const budget = scenario().at(-1).budgets[0];
  const actuals = [{ code: "R", year: 2027, months: values }];
  const root = buildVarianceTree(budget, revision, from, to, actuals);
  return { root, chart: varianceChartData(budget, revision, from, to, actuals, root) };
};

test("i grafici riconciliano mesi e sole foglie con la stessa tabella senza doppi conteggi", () => {
  const { root, chart } = makeData();
  assert.equal(chart.voices.length, 1);
  assert.equal(chart.voices[0].code, "R");
  for (const key of ["updated", "actual"]) {
    assert.equal(chart.monthly.reduce((sum, row) => sum + cents(row[key]), 0), cents(root[key]));
    assert.equal(chart.voices.reduce((sum, row) => sum + cents(row[key]), 0), cents(root[key]));
  }
});

test("periodo e revisione cambiano i mesi pianificati ma non il consuntivo", () => {
  const original = makeData(undefined, "2027-01", "2027-03", 0);
  const revised = makeData(undefined, "2027-01", "2027-03", 1);
  assert.equal(original.chart.monthly.length, 3);
  assert.equal(original.chart.monthly[0].updated, 100);
  assert.equal(revised.chart.monthly[0].updated, 105);
  assert.deepEqual(original.chart.monthly.map((row) => row.actual), revised.chart.monthly.map((row) => row.actual));
  assert.equal(makeData(undefined, "2027-02", "2027-02").chart.monthly[0].actual, 20);
});

test("i mesi mancanti interrompono la linea del consuntivo senza azzerarla o collegare il vuoto", () => {
  const { root, chart } = makeData([110, null, 120, ...Array(9).fill(0)], "2027-01", "2027-03");
  assert.equal(root.actual, null);
  assert.equal(chart.voices[0].actual, null);
  assert.deepEqual(chart.monthly.map((row) => row.actual), [110, null, 120]);
  const html = varianceChartsHtml(chart);
  const path = html.match(/class="chart-actual-line" d="([^"]*)"/)[1];
  assert.equal((path.match(/M/g) || []).length, 2);
  assert.equal((path.match(/L/g) || []).length, 0);
  assert.match(html, /si interrompe/);
  assert.ok(!html.includes("NaN"));
});

test("scale includono zero e valori negativi e restano finite per serie tutte a zero", () => {
  const scale = varianceChartScale([-500, 250, null]);
  assert.ok(scale.low <= -500 && scale.high >= 250);
  assert.ok(scale.ticks.includes(0));
  const zero = varianceChartScale([0, 0, null]);
  assert.equal(zero.low, 0);
  assert.ok(zero.high > 0);
  const html = varianceChartsHtml(makeData(Array(12).fill(0), "2027-02", "2027-02").chart);
  assert.ok(!/NaN|Infinity/.test(html));
  assert.match(html, /Feb 2027/);
});

test("il grafico mensile conserva gli anni e riconcilia un investimento pluriennale", () => {
  const budget = extendedScenarios()[1].at(-1).budgets[0];
  const actuals = [2027, 2028].map((year) => ({ code: "P", year, months: Array(12).fill(10.01) }));
  const root = buildVarianceTree(budget, 1, "2027-01", "2028-12", actuals);
  const chart = varianceChartData(budget, 1, "2027-01", "2028-12", actuals, root);
  assert.equal(chart.monthly.length, 24);
  assert.equal(chart.monthly.reduce((sum, row) => sum + cents(row.updated), 0), cents(root.updated));
  const html = varianceChartsHtml(chart);
  assert.match(html, /Gen 2027/);
  assert.match(html, /Dic 2028/);
});

test("tutte le voci restano consultabili, con valori esatti e testi escapati", () => {
  const { chart } = makeData();
  chart.voices = Array.from({ length: 22 }, (_, index) => ({ ...chart.voices[0], code: `R${index}`, name: '<img src=x onerror="alert(1)"> descrizione lunga di prova' }));
  const html = varianceChartsHtml(chart);
  assert.equal((html.match(/data-chart-detail=/g) || []).length, 22 + 12);
  assert.match(html, /R21/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /110,00/);
  assert.ok(!html.includes("<img"));
  assert.equal((html.match(/<figure /g) || []).length, 2);
});
