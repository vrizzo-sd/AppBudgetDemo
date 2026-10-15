import { normalizeCode } from "./formatters.js";
import { planningYearMonths } from "./budget-hierarchy.js";

const cents = (amount) => Math.round(amount * 100);

export function comparisonPeriods(from, to) {
  const ordinal = (value) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("Seleziona il mese iniziale e finale.");
    const [year, month] = value.split("-").map(Number);
    if (year < 2000 || year > 2100) throw new Error("Il periodo deve essere compreso tra il 2000 e il 2100.");
    return year * 12 + month - 1;
  };
  const start = ordinal(from), end = ordinal(to);
  if (start > end) throw new Error("Il mese iniziale deve precedere o coincidere con quello finale.");
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const value = start + index;
    return { year: Math.floor(value / 12), month: value % 12 };
  });
}

function comparisonValues(initial, updated, actual) {
  const delta = actual === null ? null : actual - updated;
  return { initial: initial / 100, adjustment: (updated - initial) / 100,
    updated: updated / 100, actual: actual === null ? null : actual / 100,
    delta: delta === null ? null : delta / 100,
    percent: delta === null || updated === 0 ? null : delta / updated * 100 };
}

// The adapter receives already aggregated amounts. No accounting mapping is inferred here.
export function buildVarianceTree(budget, revisionNumber, from, to, actuals) {
  const revision = budget.revisions?.find((item) => item.number === revisionNumber);
  if (budget.workflowState !== "Approvato" || !revision || !budget.baseSnapshot) {
    throw new Error("Seleziona una versione con una revisione approvata.");
  }
  const periods = comparisonPeriods(from, to);
  if (periods.some(({ year }) => year < budget.year || budget.type !== "Investimento" && year !== budget.year)) {
    throw new Error("Per l’ordinario seleziona mesi dell’anno del budget; per l’investimento parti dall’anno del budget.");
  }
  const planning = revision.planning, base = budget.baseSnapshot;
  const leafRows = (value) => value.mode === "single-level" ? value.level1 : value.level2;
  const leaves = leafRows(planning).map((row) => {
    const initialRow = leafRows(base).find((item) => item.id === row.id);
    if (!initialRow) throw new Error("La revisione non corrisponde alla base approvata.");
    let initial = 0, updated = 0, actual = 0;
    let available = true;
    for (const { year, month } of periods) {
      initial += cents(planningYearMonths(initialRow, year, budget.year)[month]);
      updated += cents(planningYearMonths(row, year, budget.year)[month]);
      const source = actuals.find((item) => normalizeCode(item.code) === normalizeCode(row.code) && item.year === year);
      const value = source?.months[month];
      if (typeof value !== "number" || !Number.isFinite(value)) available = false;
      else actual += cents(value);
    }
    return { id: row.id, parentId: row.parentId, code: row.code, name: row.name, children: [],
      ...comparisonValues(initial, updated, available ? actual : null) };
  });
  const aggregate = (id, code, name, children) => ({ id, code, name, children,
    ...comparisonValues(
      children.reduce((sum, row) => sum + cents(row.initial), 0),
      children.reduce((sum, row) => sum + cents(row.updated), 0),
      children.length && children.every((row) => row.actual !== null)
        ? children.reduce((sum, row) => sum + cents(row.actual), 0) : null,
    ) });
  const children = planning.mode === "single-level" ? leaves : planning.level1.map((parent) =>
    aggregate(parent.id, parent.code, parent.name, leaves.filter((row) => row.parentId === parent.id)));
  return aggregate("variance-root", "", `Totale budget ${budget.name}`, children);
}
