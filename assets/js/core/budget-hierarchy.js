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

export function createBudgetPlanning(budget, sourceRows) {
  if (budget.type === "Investimento") {
    return {
      mode: "single-level",
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
            Math.abs(monthlyTotal(level.months) - Number(level.budget || 0)) >
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
