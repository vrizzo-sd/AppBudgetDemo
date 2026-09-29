import test from "node:test";
import assert from "node:assert/strict";

import {
  createBudgetPlanning,
  ensureBudgetPlanning,
  level2Budget,
  levelPercentOfTotal,
  planningTotal,
  planningValidation,
} from "../assets/js/core/budget-hierarchy.js";

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
        parentPercent: 80,
        months: months(4000),
      },
      {
        id: "gra-lab",
        parentId: "gra",
        code: "GRA002",
        name: "GRANA LAB",
        parentPercent: 20,
        months: months(1000),
      },
      {
        id: "tra-prod",
        parentId: "tra",
        code: "TRA001",
        name: "TRAD PROD",
        parentPercent: 100,
        months: months(1000),
      },
      {
        id: "sie-prod",
        parentId: "sie",
        code: "SIE001",
        name: "SIE PROD",
        parentPercent: 100,
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
  assert.equal(level2Budget(planning, planning.level2[0]), 4800);
  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.monthlyErrors.map((level) => level.id),
    ["gra-prod", "gra-lab"],
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
