import test from "node:test";
import assert from "node:assert/strict";

import { copyBudgetWithNextVersion } from "../assets/js/core/budget-versioning.js";

test("la copia usa la versione successiva e parte disattiva", () => {
  const budgets = [
    {
      id: "grana-v1",
      year: 2027,
      name: "GRANA",
      version: 1,
      state: "Attivo",
      children: [{ id: "gra-1", code: "GRA-001" }],
    },
    {
      id: "grana-v3",
      year: 2027,
      name: "GRANA",
      version: 3,
      state: "Disattivo",
      children: [{ id: "gra-3", code: "GRA-001" }],
    },
    {
      id: "grana-2026",
      year: 2026,
      name: "GRANA",
      version: 8,
      state: "Attivo",
      children: [],
    },
  ];
  const ids = ["budget-copy", "level-copy"];

  const copied = copyBudgetWithNextVersion(
    budgets,
    budgets[0],
    () => ids.shift(),
  );

  assert.equal(copied.id, "bdg-budget-copy");
  assert.equal(copied.version, 4);
  assert.equal(copied.state, "Disattivo");
  assert.equal(copied.children[0].id, "level-level-copy");
  assert.equal(copied.children[0].code, "GRA-001");
  assert.equal(budgets[0].version, 1);
  assert.equal(budgets[0].children[0].id, "gra-1");
});
