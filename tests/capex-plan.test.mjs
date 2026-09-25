import test from "node:test";
import assert from "node:assert/strict";
import {
  annualDepreciation,
  annualPaymentSummary,
  componentSchedule,
  generateInstallments,
  scheduleTotals,
} from "../assets/js/core/capex-plan.js";

test("120 rate fornitore ripartiscono tutto il CAPEX, anche dopo il primo anno", () => {
  const schedule = generateInstallments({
    mode: "fornitore", amount: 100000, firstDate: "2027-01-01",
    count: 120, intervalMonths: 1, annualRate: 0,
  });
  assert.equal(schedule.length, 120);
  assert.deepEqual(scheduleTotals(schedule), { principal: 10000000, interest: 0 });
  const component = { approved: 100000, adjustment: 0, paymentSchedule: schedule };
  assert.equal(annualPaymentSummary(component, 2027, 2027).cashTotal, 10000);
  assert.equal(annualPaymentSummary(component, 2027, 2027).remainingPrincipal, 90000);
  assert.equal(annualPaymentSummary(component, 2036, 2027).remainingPrincipal, 0);
});

test("finanziamento distingue capitale, interessi e uscita di cassa", () => {
  const schedule = generateInstallments({
    mode: "finanziamento", amount: 100000, firstDate: "2027-01-01",
    count: 120, intervalMonths: 1, annualRate: 4,
  });
  const totals = scheduleTotals(schedule);
  const annual = annualPaymentSummary({ approved: 100000, adjustment: 0, paymentSchedule: schedule }, 2027, 2027);
  assert.equal(totals.principal, 10000000);
  assert.ok(totals.interest > 0);
  assert.ok(annual.cashTotal > annual.principal);
  assert.equal(Math.round((annual.principal + annual.interest) * 100), Math.round(annual.cashTotal * 100));
});

test("ammortamento decorre dall'entrata in funzione, non dalla prima rata", () => {
  const component = { approved: 100000, adjustment: 0, life: 10, inServiceDate: "2027-07-01" };
  const quotas = Array.from({ length: 11 }, (_, index) => annualDepreciation(component, 2027 + index, 2027));
  assert.equal(quotas[0], 5000);
  assert.equal(quotas.at(-1), 5000);
  assert.equal(Math.round(quotas.reduce((sum, value) => sum + value, 0) * 100), 10000000);
});

test("vecchio piano demo a quattro scadenze resta leggibile", () => {
  const component = { approved: 100, adjustment: 0, payments: [25, 25, 25, 25] };
  assert.equal(componentSchedule(component, 2027).length, 12);
  assert.equal(annualPaymentSummary(component, 2027, 2027).cashTotal, 100);
});
