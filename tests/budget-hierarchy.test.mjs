import test from "node:test";
import assert from "node:assert/strict";

import {
  createBudgetPlanning,
  ensureBudgetPlanning,
  distributeLevel1Equally,
  distributeLevel2Equally,
  level2Budget,
  levelPercentOfTotal,
  planningAllYearsTotal,
  planningTotal,
  planningValidation,
  planningYearMonths,
  syncSingleLevelBudgetPercentages,
  syncRedistributedBudget,
  setPlanningMonthAmount,
} from "../assets/js/core/budget-hierarchy.js";
import { hierarchyMonthlyRowsHtml, hierarchyMonthlyTotalHtml } from "../assets/js/components/analysis-tables.js";

function months(total) {
  return [total, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

test("calcola percentuali sul padre e sul totale generale", () => {
  const planning = {
    mode: "two-level",
    level1: [
      { id: "gra", code: "GRA000", name: "GRANA", budget: 5000 },
      { id: "tra", code: "TRA000", name: "TRADIZIONALI", budget: 1000 },
      { id: "sie", code: "SIE000", name: "SIERO", budget: 2000 },
    ],
    level2: [
      {
        id: "gra-prod",
        parentId: "gra",
        code: "GRA001",
        name: "GRANA PROD",
        totalPercent: 50,
        months: months(4000),
      },
      {
        id: "gra-lab",
        parentId: "gra",
        code: "GRA002",
        name: "GRANA LAB",
        totalPercent: 12.5,
        months: months(1000),
      },
      {
        id: "tra-prod",
        parentId: "tra",
        code: "TRA001",
        name: "TRAD PROD",
        totalPercent: 12.5,
        months: months(1000),
      },
      {
        id: "sie-prod",
        parentId: "sie",
        code: "SIE001",
        name: "SIE PROD",
        totalPercent: 25,
        months: months(2000),
      },
    ],
  };

  assert.equal(planningTotal(planning), 8000);
  assert.equal(level2Budget(planning, planning.level2[0]), 4000);
  assert.equal(
    levelPercentOfTotal(
      planning,
      level2Budget(planning, planning.level2[0]),
    ),
    50,
  );
  assert.equal(planningValidation(planning).valid, true);

  planning.level1[0].budget = 6000;
  const validation = planningValidation(planning);
  assert.equal(level2Budget(planning, planning.level2[0]), 4500);
  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.monthlyErrors.map((level) => level.id),
    ["gra-prod", "gra-lab", "tra-prod", "sie-prod"],
  );
});

test("un investimento usa un solo livello con mesi modificabili", () => {
  const budget = {
      id: "inv",
      type: "Investimento",
      children: [
        { id: "personale", code: "CI001", name: "Costo personale" },
        { id: "impianto", code: "CI002", name: "Costo impianto" },
      ],
    };
  const sourceRows = [
      { code: "CI001", values: months(1200) },
      { code: "CI002", values: months(6800) },
    ];
  const planning = createBudgetPlanning(budget, sourceRows);
  budget.planning = planning;
  ensureBudgetPlanning(budget, sourceRows);

  assert.equal(planning.mode, "single-level");
  assert.equal(planning.level1.length, 2);
  assert.equal(planning.level2.length, 0);
  assert.equal(planningTotal(planning), 8000);
  assert.equal(planningValidation(planning).valid, true);
  assert.equal(planning.catalog.level1.length, 2);

  planning.level1[0].monthlyActive = false;
  assert.equal(planningValidation(planning).valid, false);
});

test("gli importi di un investimento definiscono il totale prima della ripartizione percentuale", () => {
  const budget = {
    id: "depuratore",
    year: 2027,
    type: "Investimento",
    children: [
      { id: "nuovo", code: "CAP-DEP-01", name: "Nuovo depuratore" },
      { id: "adeguamento", code: "CAP-DEP-02", name: "Adeguamento" },
    ],
  };
  const planning = ensureBudgetPlanning(budget, [
    { code: "CAP-DEP-01", values: months(240000) },
    { code: "CAP-DEP-02", values: months(130000) },
  ]);
  planning.level1[0].budget = 2000000;
  syncSingleLevelBudgetPercentages(planning);
  assert.equal(planning.totalBudget, 2130000);
  assert.ok(Math.abs(planning.level1.reduce((sum, level) => sum + level.totalPercent, 0) - 100) < 1e-8);

  planning.level1[1].budget = 2000000;
  syncSingleLevelBudgetPercentages(planning);
  assert.equal(planning.totalBudget, 4000000);
  assert.deepEqual(planning.level1.map((level) => level.totalPercent), [50, 50]);
  assert.equal(planningValidation(planning).allocationPercentError, false);

  planning.level1[0].totalPercent = 60;
  planning.level1[0].budget = planning.totalBudget * 0.6;
  assert.equal(planning.totalBudget, 4000000);
  assert.equal(planningValidation(planning).allocationPercentError, true);
  planning.level1[1].totalPercent = 40;
  planning.level1[1].budget = planning.totalBudget * 0.4;
  assert.equal(planningTotal(planning), 4000000);
  assert.equal(planningValidation(planning).allocationPercentError, false);
});

test("una bozza investimento con percentuali obsolete oltre il 100% recupera gli importi inseriti", () => {
  const budget = {
    id: "depuratore-salvato",
    year: 2027,
    type: "Investimento",
    planning: {
      mode: "single-level",
      level1: [
        { id: "nuovo", budget: 2000000, totalPercent: 540.54, months: months(2000000) },
        { id: "adeguamento", budget: 2000000, totalPercent: 540.54, months: months(2000000) },
      ],
      level2: [],
      totalBudget: 370000,
    },
  };
  const planning = ensureBudgetPlanning(budget, []);
  assert.equal(planning.totalBudget, 4000000);
  assert.deepEqual(planning.level1.map((level) => level.totalPercent), [50, 50]);
  assert.equal(planningValidation(planning).valid, true);
});

test("Ripartisci aggiorna importo e percentuali della voce di investimento", () => {
  const planning = {
    mode: "single-level",
    totalBudget: 200,
    level1: [
      { id: "a", budget: 100, totalPercent: 50, months: months(100) },
      { id: "b", budget: 100, totalPercent: 50, months: months(100) },
    ],
    level2: [],
  };
  planning.level1[0].months = months(150);
  assert.equal(syncRedistributedBudget(planning, planning.level1[0], 100, 150), true);
  assert.equal(planning.totalBudget, 250);
  assert.deepEqual(planning.level1.map((level) => level.totalPercent), [60, 40]);
  assert.equal(planningValidation(planning).valid, true);
});

test("Ripartisci aggiorna anche il padre nel budget ordinario", () => {
  const planning = {
    mode: "two-level",
    totalBudget: 200,
    level1: [
      { id: "a", budget: 100, totalPercent: 50 },
      { id: "b", budget: 100, totalPercent: 50 },
    ],
    level2: [
      { id: "a1", parentId: "a", totalPercent: 50, months: months(100) },
      { id: "b1", parentId: "b", totalPercent: 50, months: months(100) },
    ],
  };
  planning.level2[0].months = months(150);
  assert.equal(syncRedistributedBudget(planning, planning.level2[0], 100, 150), true);
  assert.equal(planning.totalBudget, 250);
  assert.deepEqual(planning.level1.map((level) => level.budget), [150, 100]);
  assert.deepEqual(planning.level1.map((level) => level.totalPercent), [60, 40]);
  assert.deepEqual(planning.level2.map((level) => level.totalPercent), [60, 40]);
  assert.equal(planningValidation(planning).valid, true);
});

test("modificare un mese della tabella 3 aggiorna voce e padre nel budget ordinario", () => {
  const planning = {
    mode: "two-level",
    totalBudget: 300,
    level1: [
      { id: "a", budget: 200, totalPercent: 200 / 3 },
      { id: "b", budget: 100, totalPercent: 100 / 3 },
    ],
    level2: [
      { id: "a1", parentId: "a", totalPercent: 200 / 3, months: months(200) },
      { id: "b1", parentId: "b", totalPercent: 100 / 3, months: months(100) },
    ],
  };
  assert.equal(setPlanningMonthAmount(planning, planning.level2[0], 2027, 1, 50), true);
  assert.deepEqual(planning.level2[0].months.slice(0, 3), [200, 50, 0]);
  assert.equal(planning.level1[0].budget, 250);
  assert.equal(planning.totalBudget, 350);
  assert.equal(level2Budget(planning, planning.level2[0]), 250);
  assert.equal(planningValidation(planning).valid, true);
});

test("modificare un mese di un altro anno aggiorna il budget investimento complessivo", () => {
  const planning = {
    mode: "single-level",
    budgetYear: 2027,
    totalBudget: 200,
    level1: [
      { id: "a", budget: 100, totalPercent: 50, months: months(100), yearMonths: { 2028: months(0) } },
      { id: "b", budget: 100, totalPercent: 50, months: months(100) },
    ],
    level2: [],
  };
  assert.equal(setPlanningMonthAmount(planning, planning.level1[0], 2028, 2, 50), true);
  assert.equal(planning.level1[0].months[0], 100);
  assert.equal(planningYearMonths(planning.level1[0], 2028, 2027)[2], 50);
  assert.equal(planning.level1[0].budget, 150);
  assert.equal(planning.totalBudget, 250);
  assert.deepEqual(planning.level1.map((level) => level.totalPercent), [60, 40]);
  assert.equal(planningValidation(planning).valid, true);
});

test("un investimento ripartito su due anni conserva il totale e mostra l'anno selezionato", () => {
  const budget = {
    id: "inv-pluriennale",
    year: 2027,
    type: "Investimento",
    children: [{ id: "impianto", code: "CI002", name: "Impianto" }],
  };
  const planning = ensureBudgetPlanning(budget, [{ code: "CI002", values: months(1200) }]);
  const level = planning.level1[0];
  assert.equal(planningYearMonths(level, 2028, budget.year)[0], 0);
  level.months = months(400);
  level.yearMonths = { 2028: months(800) };
  assert.equal(planningAllYearsTotal(level), 1200);
  assert.equal(planningValidation(planning).valid, true);

  const current = hierarchyMonthlyRowsHtml(planning, planningValidation(planning), [level], new Set(), new Set(), false, undefined, 2027);
  const next = hierarchyMonthlyRowsHtml(planning, planningValidation(planning), [level], new Set(), new Set(), false, undefined, 2028);
  assert.match(current, /value="400\.00"/);
  assert.match(next, /value="800\.00"/);
  assert.doesNotMatch(next, /value="400\.00"/);
  assert.match(hierarchyMonthlyTotalHtml(planning, [level], false, undefined, 2028), /800\s*€/);

  level.yearMonths[2028][0] = 799;
  assert.deepEqual(planningValidation(planning).monthlyErrors.map((item) => item.id), [level.id]);
});

test("il catalogo conserva il collegamento esplicito tra padre e figlio", () => {
  const budget = {
    id: "ordinario",
    type: "Ordinario",
    name: "Budget ordinario",
    children: [{ id: "gra-prod", code: "GRA-001", name: "Produzione" }],
  };
  ensureBudgetPlanning(budget, [
    { code: "GRA-001", values: months(5000) },
  ]);

  assert.equal(budget.planning.level1[0].code, "GRA000");
  assert.equal(budget.planning.level2[0].parentCode, "GRA000");
  assert.equal(budget.planning.catalog.level2[0].parentCode, "GRA000");
});


test("ripartizione equa dei figli conserva i centesimi dei padri senza sommare percentuali arrotondate", () => {
  const amounts = [1985800, 1663107.5, 1413889.6, 895610, 3972592.9];
  const counts = [4, 3, 3, 3, 9];
  const totalBudget = 9931000;
  const level1 = amounts.map((budget, index) => ({
    id: `p${index}`, budget, totalPercent: budget / totalBudget * 100,
  }));
  const planning = { mode: "two-level", totalBudget, level1,
    level2: level1.flatMap((parent, index) => Array.from({ length: counts[index] }, (_, child) => ({
      id: `${parent.id}-${child}`, parentId: parent.id, totalPercent: 0, months: months(0),
    }))),
  };
  const parentsBefore = structuredClone(level1);
  // The previous calculation rounded each parent percentage before splitting it.
  const oldPercentSum = level1.reduce((sum, parent) => sum + Math.round(parent.totalPercent * 100) / 100, 0);
  assert.ok(Math.abs(oldPercentSum - 100.01) < 1e-8);
  assert.equal(distributeLevel2Equally(planning), true);
  assert.deepEqual(planning.level1, parentsBefore);
  for (const parent of level1) {
    const children = planning.level2.filter((level) => level.parentId === parent.id);
    const cents = children.map((level) => Math.round(level2Budget(planning, level) * 100));
    assert.equal(cents.reduce((sum, value) => sum + value, 0), Math.round(parent.budget * 100));
    assert.ok(Math.max(...cents) - Math.min(...cents) <= 1);
    children.forEach((level, index) => { level.months = months(cents[index] / 100); });
  }
  assert.equal(planning.totalBudget, totalBudget);
  assert.equal(planningValidation(planning).valid, true);
  assert.equal(planningValidation(JSON.parse(JSON.stringify(planning))).valid, true);
});

test("ripartizione equa del Livello 1 divide gli euro con al massimo un centesimo di differenza", () => {
  const planning = { mode: "two-level", totalBudget: 9941000,
    level1: [0, 1, 2].map((id) => ({ id, budget: id === 0 ? 9941000 : 0, totalPercent: id === 0 ? 100 : 0 })),
    level2: [{ id: "child", parentId: 0, totalPercent: 100, months: months(9941000) }],
  };
  const childBefore = structuredClone(planning.level2);
  assert.equal(distributeLevel1Equally(planning), true);
  assert.deepEqual(planning.level1.map((level) => level.budget), [3313666.67, 3313666.67, 3313666.66]);
  assert.equal(Math.round(planningTotal(planning) * 100), 994100000);
  assert.equal(planningValidation(planning).allocationPercentError, false);
  assert.deepEqual(planning.level2, childBefore);
});

test("ripartizione dei figli gestisce residui inferiori al numero di righe e conserva quadrature incomplete", () => {
  const planning = { mode: "two-level", totalBudget: 1,
    level1: [{ id: "p", budget: 0.01, totalPercent: 1 }],
    level2: [0, 1, 2].map((id) => ({ id, parentId: "p", totalPercent: 0, months: months(0) })),
  };
  distributeLevel2Equally(planning);
  assert.deepEqual(planning.level2.map((level) => level2Budget(planning, level)), [0.01, 0, 0]);
  const validation = planningValidation(planning);
  assert.equal(validation.level2AllocationErrors.length, 0);
  assert.equal(validation.level2TotalPercentError, true);
  assert.equal(validation.allocationPercentError, true);
  assert.equal(validation.valid, false);
});
