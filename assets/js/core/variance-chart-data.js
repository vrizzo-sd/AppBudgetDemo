import { buildVarianceTree, comparisonPeriods } from "./variance-analysis.js";

export function varianceChartData(budget, revision, from, to, actuals, root) {
  const voices = [];
  const visit = (row) => {
    if (row.children.length) row.children.forEach(visit);
    else voices.push(row);
  };
  visit(root);
  const monthly = comparisonPeriods(from, to).map(({ year, month }) => {
    const period = `${year}-${String(month + 1).padStart(2, "0")}`;
    const values = buildVarianceTree(budget, revision, period, period, actuals);
    return { year, month, updated: values.updated, actual: values.actual };
  });
  return { voices, monthly };
}
