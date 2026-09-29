import { clone } from "./formatters.js";

export function copyBudgetWithNextVersion(budgets, source, createId) {
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
  copied.children = copied.children.map((child) => ({
    ...child,
    id: `level-${createId()}`,
  }));
  return copied;
}
