import { clone } from "./formatters.js";
import { effectivePlanning } from "./budget-workflow.js";

export function copyBudgetWithNextVersion(budgets, source, createId, adjustments = []) {
  const nextVersion =
    Math.max(
      ...budgets
        .filter(
          (budget) =>
            budget.name === source.name && budget.year === source.year,
        )
        .map((budget) => Number(budget.version) || 0),
    ) + 1;
  const copied = clone(source);
  copied.id = `bdg-${createId()}`;
  copied.version = nextVersion;
  copied.state = "Disattivo";
  copied.workflowState = "Bozza";
  copied.isOfficial = false;
  copied.revision = 0;
  copied.revisions = [];
  copied.workflowEvents = [];
  delete copied.baseSnapshot;
  copied.copiedFrom = { budgetId: source.id, version: source.version, revision: source.revision };
  if (source.planning) {
    copied.planning = effectivePlanning(source, adjustments);
    const ids = new Map();
    [...copied.planning.level1, ...copied.planning.level2].forEach((level) => {
      ids.set(level.id, `plan-${createId()}`);
    });
    [...copied.planning.level1, ...copied.planning.level2].forEach((level) => {
      level.id = ids.get(level.id);
      if (level.parentId) level.parentId = ids.get(level.parentId);
    });
    delete copied.planning.catalog;
  }
  copied.children = copied.children.map((child) => ({
    ...child,
    id: `level-${createId()}`,
  }));
  return copied;
}
