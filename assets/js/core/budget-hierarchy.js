import { normalizeCode } from "./formatters.js";

const PARENTS = {
  GRA: { code: "GRA000", name: "GRANA" },
  TRA: { code: "TRA000", name: "TRADIZIONALI" },
  SIE: { code: "SIE000", name: "SIERO" },
  BUR: { code: "BUR000", name: "BURRO" },
  STF: { code: "STF000", name: "STAFF" },
};

function rowMonths(rows, code) {
  const normalizedCode = normalizeCode(code);
  return rows
    .filter((row) => normalizeCode(row.code) === normalizedCode)
    .reduce(
      (totals, row) =>
        totals.map((total, month) => total + Number(row.values?.[month] || 0)),
      Array(12).fill(0),
    );
}

export function monthlyTotal(values) {
  return values.reduce((sum, value) => sum + Number(value || 0), 0);
}

export function planningYearMonths(level, year, budgetYear) {
  return Number(year) === Number(budgetYear)
    ? level.months
    : level.yearMonths?.[year] || Array(12).fill(0);
}

export function planningAllYearsTotal(level) {
  return monthlyTotal(level.months) + Object.values(level.yearMonths || {})
    .reduce((sum, values) => sum + monthlyTotal(values), 0);
}

export function createBudgetPlanning(budget, sourceRows) {
  if (budget.type === "Investimento") {
    return {
      mode: "single-level",
      budgetYear: budget.year,
      level1: budget.children.map((child) => {
        const months = rowMonths(sourceRows, child.code);
        return {
          id: `l1-${child.id}`,
          code: child.code,
          name: child.name,
          budget: monthlyTotal(months),
          months,
        };
      }),
      level2: [],
    };
  }

  const groups = new Map();
  budget.children.forEach((child) => {
    const prefix = String(child.code || "")
      .slice(0, 3)
      .toUpperCase();
    const definition = PARENTS[prefix] || {
      code: `${prefix || "ALT"}000`,
      name: budget.name,
    };
    if (!groups.has(definition.code)) {
      groups.set(definition.code, {
        id: `l1-${budget.id}-${definition.code}`,
        code: definition.code,
        name: definition.name,
        budget: 0,
        children: [],
      });
    }
    const months = rowMonths(sourceRows, child.code);
    groups.get(definition.code).children.push({ child, months });
  });

  const level1 = [...groups.values()].map((group) => ({
    id: group.id,
    code: group.code,
    name: group.name,
    budget: group.children.reduce(
      (sum, item) => sum + monthlyTotal(item.months),
      0,
    ),
  }));
  const totalBudget = level1.reduce((sum, item) => sum + Number(item.budget || 0), 0);
  const level2 = [...groups.values()].flatMap((group) => {
    const parent = level1.find((item) => item.id === group.id);
    return group.children.map(({ child, months }) => {
      const initialTotal = monthlyTotal(months);
      return {
        id: `l2-${child.id}`,
        parentId: parent.id,
        parentCode: parent.code,
        code: child.code,
        name: child.name,
        totalPercent: totalBudget > 0 ? (initialTotal / totalBudget) * 100 : 0,
        months,
      };
    });
  });
  return { mode: "two-level", level1, level2 };
}

export function ensureBudgetPlanning(budget, sourceRows) {
  if (!budget.planning?.level1 || !budget.planning?.level2) {
    budget.planning = createBudgetPlanning(budget, sourceRows);
  }
  const planning = budget.planning;
  if (budget.type === "Investimento") planning.budgetYear = budget.year;
  const currentPlanningTotal = planning.level1.reduce(
    (sum, level) => sum + Number(level.budget || 0),
    0,
  );
  if (!Number.isFinite(Number(planning.totalBudget))) {
    planning.totalBudget = currentPlanningTotal;
  }
  planning.level1.forEach((level) => {
    if (!Number.isFinite(Number(level.totalPercent))) {
      level.totalPercent = planning.totalBudget > 0
        ? Number(level.budget || 0) / planning.totalBudget * 100
        : 0;
    }
  });
  // Older investment drafts calculated percentages against the original demo total
  // even after an amount edit. Percentages above 100% cannot come from the current
  // percentage control, so restore them from the entered amounts when loading.
  if (planning.mode === "single-level" && planning.level1.some((level) => Number(level.totalPercent) > 100.005)) {
    syncSingleLevelBudgetPercentages(planning);
  }
  planning.level1.forEach((level) => {
    if (level.monthlyActive === undefined) level.monthlyActive = true;
  });
  planning.level2.forEach((level) => {
    if (level.monthlyActive === undefined) level.monthlyActive = true;
    if (!level.parentCode) {
      level.parentCode = planning.level1.find(
        (parent) => parent.id === level.parentId,
      )?.code;
    }
    if (!Number.isFinite(Number(level.totalPercent))) {
      const parent = planning.level1.find((item) => item.id === level.parentId);
      const legacyBudget = Number(parent?.budget || 0) * Number(level.parentPercent || 0) / 100;
      level.totalPercent = levelPercentOfTotal(planning, legacyBudget);
    }
  });
  if (!planning.catalog) {
    planning.catalog = {
      level1: planning.level1.map((level) => ({
        id: level.id,
        code: level.code,
        name: level.name,
      })),
      level2: planning.level2.map((level) => ({
        id: level.id,
        parentId: level.parentId,
        parentCode: level.parentCode,
        code: level.code,
        name: level.name,
      })),
    };
  }
  return budget.planning;
}

export function planningTotal(planning) {
  return planning.level1.reduce(
    (sum, level) => sum + Number(level.budget || 0),
    0,
  );
}

export function syncSingleLevelBudgetPercentages(planning) {
  if (planning.mode !== "single-level") return;
  const total = planningTotal(planning);
  planning.totalBudget = total;
  planning.level1.forEach((level) => {
    level.totalPercent = total > 0 ? Number(level.budget || 0) / total * 100 : 0;
  });
}

export function syncRedistributedBudget(planning, level, previousAmount, nextAmount) {
  if (planning.mode === "single-level") {
    level.budget = nextAmount;
    syncSingleLevelBudgetPercentages(planning);
    return true;
  }
  const parent = planning.level1.find((item) => item.id === level.parentId);
  if (!parent) return false;
  parent.budget = Math.round((Number(parent.budget || 0) + nextAmount - previousAmount) * 100) / 100;
  const total = planningTotal(planning);
  planning.totalBudget = total;
  planning.level1.forEach((item) => {
    item.totalPercent = total > 0 ? Number(item.budget || 0) / total * 100 : 0;
  });
  planning.level2.forEach((item) => {
    item.totalPercent = total > 0 ? monthlyTotal(item.months) / total * 100 : 0;
  });
  return true;
}

export function setPlanningMonthAmount(planning, level, year, month, amount) {
  if (!Number.isInteger(month) || month < 0 || month > 11 ||
      !Number.isFinite(amount) || amount < 0 ||
      Math.abs(Math.round(amount * 100) - amount * 100) > 1e-7) return false;
  if (planning.mode !== "single-level" &&
      !planning.level1.some((item) => item.id === level.parentId)) return false;
  const previousAmount = planning.mode === "single-level"
    ? planningAllYearsTotal(level)
    : monthlyTotal(level.months);
  let values = level.months;
  if (planning.mode === "single-level" && Number(year) !== Number(planning.budgetYear)) {
    level.yearMonths ||= {};
    level.yearMonths[year] ||= Array(12).fill(0);
    values = level.yearMonths[year];
  }
  values[month] = Math.round(amount * 100) / 100;
  const nextAmount = planning.mode === "single-level"
    ? planningAllYearsTotal(level)
    : monthlyTotal(level.months);
  if (Math.round(nextAmount * 100) !== Math.round(previousAmount * 100)) {
    syncRedistributedBudget(planning, level, previousAmount, nextAmount);
  }
  return true;
}

export function planningBaseTotal(planning) {
  const configured = Number(planning.totalBudget);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : planningTotal(planning);
}

export function level2Budget(planning, level) {
  return planningBaseTotal(planning) * (Number(level.totalPercent || 0) / 100);
}

export function levelPercentOfTotal(planning, amount) {
  const total = planningBaseTotal(planning);
  return total ? (Number(amount || 0) / total) * 100 : 0;
}

export function planningValidation(planning) {
  const allocationPercent = planning.level1.reduce(
    (sum, level) => sum + Number(level.totalPercent ?? levelPercentOfTotal(planning, level.budget)),
    0,
  );
  const allocationPercentError = Math.abs(allocationPercent - 100) > 0.005;
  const level2AllocationErrors = planning.mode === "single-level"
    ? []
    : planning.level1.flatMap((parent) => {
        const children = planning.level2.filter((level) => level.parentId === parent.id);
        if (!children.length) return [];
        const actualPercent = children.reduce((sum, level) => sum + Number(level.totalPercent || 0), 0);
        const expectedPercent = Number(parent.totalPercent ?? levelPercentOfTotal(planning, parent.budget));
        return Math.abs(actualPercent - expectedPercent) > 0.005
          ? [{ id: parent.id, expectedPercent, actualPercent, deltaPercent: actualPercent - expectedPercent }]
          : [];
      });
  const level2TotalPercent = planning.mode === "single-level"
    ? 100
    : planning.level2.reduce(
        (sum, level) => sum + Number(level.totalPercent || 0),
        0,
      );
  const level2TotalPercentError = planning.mode !== "single-level" && planningBaseTotal(planning) > 0 &&
    Math.abs(level2TotalPercent - 100) > 0.005;
  const monthlyErrors =
    planning.mode === "single-level"
      ? planning.level1.filter(
          (level) =>
            level.monthlyActive === false ||
            Math.abs(planningAllYearsTotal(level) - Number(level.budget || 0)) >
            0.005,
        )
      : planning.level2.filter(
          (level) =>
            level.monthlyActive === false ||
            Math.abs(
              monthlyTotal(level.months) - level2Budget(planning, level),
            ) > 0.005,
        );
  return {
    valid: !allocationPercentError && !level2AllocationErrors.length && !level2TotalPercentError && !monthlyErrors.length,
    allocationPercentError,
    allocationPercent,
    level2AllocationErrors,
    level2TotalPercentError,
    level2TotalPercent,
    monthlyErrors,
  };
}
