import { escapeHtml, euro, normalizeCode } from "../core/formatters.js";
import {
  level2Budget,
  levelPercentOfTotal,
  planningBaseTotal,
  monthlyTotal,
  planningAllYearsTotal,
  planningYearMonths,
  planningTotal,
} from "../core/budget-hierarchy.js";

const percentage = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function roundedPercentageMap(items, getPercent) {
  const exact = items.map((item) => ({
    id: item.id,
    units: Math.max(0, Number(getPercent(item) || 0)) * 100,
  }));
  const roundedUnits = exact.map((item) => Math.floor(item.units + 1e-8));
  const target = Math.round(exact.reduce((sum, item) => sum + item.units, 0));
  let remaining = target - roundedUnits.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((item, index) => ({ index, fraction: item.units - Math.floor(item.units + 1e-8) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remaining; i += 1) roundedUnits[order[i % order.length].index] += 1;
  return new Map(exact.map((item, index) => [item.id, roundedUnits[index] / 100]));
}

export function hierarchyLevel1RowsHtml(
  planning,
  validation,
  levels = planning.level1,
  selectedIds = new Set(),
  editingIds = new Set(),
) {
  const displayedPercentages = roundedPercentageMap(
    planning.level1,
    (level) => level.totalPercent ?? levelPercentOfTotal(planning, level.budget),
  );
  const rows = levels
    .map((level) => {
      const invalid = validation.allocationPercentError;
      const selected = selectedIds.has(level.id);
      return `<tr class="${[invalid ? "planning-invalid" : "", selected ? "planning-selected" : ""].filter(Boolean).join(" ")}" data-select-l1="${escapeHtml(level.id)}" tabindex="0"><td>${escapeHtml(level.code)}</td><td>${escapeHtml(level.name)}</td><td class="num"><input class="planning-number" data-l1-budget="${escapeHtml(level.id)}" type="number" min="0" step="0.01" value="${Number(level.budget || 0).toFixed(2)}" aria-label="Budget ${escapeHtml(level.name)}"></td><td class="num"><div class="planning-percent-input"><input class="planning-number" data-l1-percent="${escapeHtml(level.id)}" type="number" min="0" max="100" step="0.01" value="${Number(displayedPercentages.get(level.id) || 0).toFixed(2)}" aria-label="Percentuale sul totale di ${escapeHtml(level.name)}"><span>%</span></div></td><td class="planning-actions"><button class="action-icon is-hidden" type="button" data-planning-edit="l1" data-planning-id="${escapeHtml(level.id)}" aria-hidden="true" tabindex="-1" title="Modifica">✎</button><button class="action-icon danger" type="button" data-planning-delete="l1" data-planning-id="${escapeHtml(level.id)}" aria-label="Elimina ${escapeHtml(level.name)}" title="Elimina">🗑</button></td></tr>`;
    })
    .join("");
  const percentageTotal = [...displayedPercentages.values()].reduce((sum, value) => sum + value, 0);
  return `${rows}<tr class="total-row"><td colspan="2">TOTALE</td><td class="num">${euro.format(planningTotal(planning))}</td><td class="num">${percentage.format(percentageTotal)}%</td><td></td></tr>`;
}

export function hierarchyLevel2RowsHtml(
  planning,
  validation,
  levels = planning.level2,
  selectedIds = new Set(),
  editingIds = new Set(),
) {
  if (planning.mode === "single-level") {
    return '<tr><td colspan="5" class="center muted">Per la commessa è gestito un solo livello.</td></tr>';
  }
  if (!levels.length) {
    return '<tr><td colspan="5" class="center muted">Nessun elemento di Livello 2 disponibile.</td></tr>';
  }
  const displayedTotalPercentages = roundedPercentageMap(
    planning.level2,
    (level) => level.totalPercent ?? levelPercentOfTotal(planning, level2Budget(planning, level)),
  );
  const rows = levels
    .map((level) => {
      const budget = level2Budget(planning, level);
      const parent = planning.level1.find((item) => item.id === level.parentId);
      const invalid = validation.monthlyErrors.some(
        (item) => item.id === level.id,
      );
      const parentAllocationInvalid = validation.level2AllocationErrors.some(
        (parent) => parent.id === level.parentId,
      );
      const selected = selectedIds.has(level.id);
      return `<tr class="${[invalid ? "planning-invalid" : "planning-valid", parentAllocationInvalid ? "planning-invalid" : "", selected ? "planning-selected" : ""].filter(Boolean).join(" ")}" data-select-l2="${escapeHtml(level.id)}" tabindex="0"><td>${escapeHtml(level.code)}</td><td>${escapeHtml(level.name)}</td><td class="num">${euro.format(budget)}</td><td class="num"><div class="planning-percent-input"><input class="planning-number planning-percent" data-l2-total-percent="${escapeHtml(level.id)}" type="number" min="0" max="100" step="0.01" value="${Number(displayedTotalPercentages.get(level.id) || 0).toFixed(2)}" aria-label="Percentuale sul totale di ${escapeHtml(level.name)}"><span>%</span></div></td><td class="planning-actions"><button class="action-icon is-hidden" type="button" data-planning-edit="l2" data-planning-id="${escapeHtml(level.id)}" aria-hidden="true" tabindex="-1" title="Modifica">✎</button><button class="action-icon danger" type="button" data-planning-delete="l2" data-planning-id="${escapeHtml(level.id)}" aria-label="Elimina ${escapeHtml(level.name)}" title="Elimina">🗑</button></td></tr>`;
    })
    .join("");
  const totalBudget = levels.reduce(
    (sum, level) => sum + level2Budget(planning, level),
    0,
  );
  const visiblePercentTotal = levels.reduce(
    (sum, level) => sum + Number(displayedTotalPercentages.get(level.id) || 0),
    0,
  );
  const totalPercentLabel = planning.mode === "single-level"
    ? "—"
    : `${percentage.format(visiblePercentTotal)}%`;
  return `${rows}<tr class="total-row"><td colspan="2">TOTALE</td><td class="num">${euro.format(totalBudget)}</td><td class="num">${totalPercentLabel}</td><td></td></tr>`;
}

export function hierarchyMonthlyRowsHtml(
  planning,
  validation,
  levels = planning.mode === "single-level"
    ? planning.level1
    : planning.level2,
  selectedIds = new Set(),
  editingIds = new Set(),
  adjustmentView = false,
  adjustmentFor = () => ({ approved: 0, draft: 0 }),
  selectedYear = planning.budgetYear,
) {
  return levels
    .filter((level) => level.monthlyActive !== false)
    .map((level) => {
      const expected =
        planning.mode === "single-level"
          ? Number(level.budget || 0)
          : level2Budget(planning, level);
      const yearMonths = planning.mode === "single-level"
        ? planningYearMonths(level, selectedYear, planning.budgetYear)
        : level.months;
      const actual = monthlyTotal(yearMonths);
      const difference = (planning.mode === "single-level" ? planningAllYearsTotal(level) : actual) - expected;
      const invalid = validation.monthlyErrors.some(
        (item) => item.id === level.id,
      );
      const monthCells = yearMonths.map((value, month) => {
        const item = adjustmentFor(level.id, month);
        const baseCell = `<td class="num"><input class="planning-number month-value" data-plan-month="${month}" data-plan-level="${escapeHtml(level.id)}" type="number" min="0" step="0.01" value="${Number(value || 0).toFixed(2)}" aria-label="Mese ${month + 1} di ${escapeHtml(level.name)}"></td>`;
        const adjustmentCell = adjustmentView ? `<td class="num adjustment-cell"><input class="planning-number adjustment-value" data-adjust-level="${escapeHtml(level.id)}" data-adjust-month="${month}" type="number" step="0.01" value="${Number(item.approved || 0).toFixed(2)}" aria-label="Rettifica applicata ${month + 1} di ${escapeHtml(level.name)}"><small>Budget mese ${euro.format(Number(value) + item.approved)}</small>${item.pending ? `<small>In approvazione ${euro.format(item.pending)}</small>` : ""}</td>` : "";
        return baseCell + adjustmentCell;
      }).join("");
      const adjustments = Array.from({ length: 12 }, (_, month) => adjustmentFor(level.id, month));
      const approved = adjustments.reduce((sum, item) => sum + item.approved, 0);
      return `<tr class="${[invalid ? "planning-invalid" : "planning-valid", selectedIds.has(level.id) ? "planning-selected" : ""].filter(Boolean).join(" ")}" data-select-monthly="${escapeHtml(level.id)}" tabindex="0"><td>${escapeHtml(level.code)}</td><td>${escapeHtml(level.name)}</td>${monthCells}<td class="num" data-monthly-base="${escapeHtml(level.id)}"><strong>${euro.format(actual)}</strong></td>${adjustmentView ? `<td class="num" data-monthly-adjustment="${escapeHtml(level.id)}">${euro.format(approved)}</td><td class="num" data-monthly-updated="${escapeHtml(level.id)}"><strong>${euro.format(actual + approved)}</strong></td>` : ""}<td class="num difference">${invalid ? euro.format(difference) : "Quadrato"}</td><td class="planning-actions"><button class="btn small" type="button" data-distribute-row="${escapeHtml(level.id)}">Ripartisci</button><button class="action-icon is-hidden" type="button" data-planning-edit="monthly" data-planning-id="${escapeHtml(level.id)}" aria-hidden="true" tabindex="-1" title="Modifica">✎</button><button class="action-icon danger" type="button" data-planning-delete="monthly" data-planning-id="${escapeHtml(level.id)}" aria-label="Rimuovi pianificazione ${escapeHtml(level.name)}" title="Elimina">🗑</button></td></tr>`;
    })
    .join("");
}

export function hierarchyMonthlyTotalHtml(
  planning,
  levels = planning.mode === "single-level"
    ? planning.level1
    : planning.level2,
  adjustmentView = false,
  adjustmentFor = () => ({ approved: 0 }),
  selectedYear = planning.budgetYear,
) {
  const activeLevels = levels.filter((level) => level.monthlyActive !== false);
  const monthTotals = Array.from({ length: 12 }, (_, month) =>
    activeLevels.reduce(
      (sum, level) => sum + Number((planning.mode === "single-level"
        ? planningYearMonths(level, selectedYear, planning.budgetYear)
        : level.months)?.[month] || 0),
      0,
    ),
  );
  const grand = monthTotals.reduce((sum, value) => sum + value, 0);
  const approvedMonths = Array.from({ length: 12 }, (_, month) => activeLevels.reduce((sum, level) => sum + adjustmentFor(level.id, month).approved, 0));
  const approved = approvedMonths.reduce((sum, value) => sum + value, 0);
  return `<tr class="total-row"><td colspan="2">TOTALE</td>${monthTotals.map((value, month) => `<td class="num">${euro.format(value)}</td>${adjustmentView ? `<td class="num adjustment-cell">${euro.format(approvedMonths[month])}</td>` : ""}`).join("")}<td class="num">${euro.format(grand)}</td>${adjustmentView ? `<td class="num">${euro.format(approved)}</td><td class="num">${euro.format(grand + approved)}</td>` : ""}<td colspan="2"></td></tr>`;
}

export function levelRowsHtml(
  levels,
  rows,
  rowTotal,
  investment = false,
  sqlLevels = null,
) {
  return levels
    .map((level) => {
      const code = normalizeCode(level.code);
      const summary = sqlLevels?.find((item) => item.source_key === level.id);
      const costs = summary
        ? summary.cost_cents / 100
        : rows.cost
            .filter((row) => normalizeCode(row.code) === code)
            .reduce((sum, row) => sum + rowTotal(row), 0);
      const revenue = summary
        ? summary.revenue_cents / 100
        : rows.revenue
            .filter((row) => normalizeCode(row.code) === code)
            .reduce((sum, row) => sum + rowTotal(row), 0);
      const fundingSource = investment
        ? `<td><input class="level-funding-source" data-level-source="${escapeHtml(level.id)}" aria-label="Fonte di finanziamento di ${escapeHtml(level.name)}" maxlength="120" value="${escapeHtml(level.fundingSource || "Da definire")}"></td>`
        : "";
      return `<tr><td>${escapeHtml(level.code)}</td><td>${escapeHtml(level.name)}</td>${fundingSource}<td class="num">${euro.format(revenue)}</td><td class="num">${euro.format(costs)}</td></tr>`;
    })
    .join("");
}

export function voiceRowsHtml(rows, rowTotal, sqlItems = null) {
  const allRows = [
    ...rows.cost.map((row) => ({ ...row, nature: "Costo" })),
    ...rows.revenue.map((row) => ({ ...row, nature: "Ricavo" })),
  ];
  return allRows
    .map((row) => {
      const summary = sqlItems?.find((item) => item.source_key === row.id);
      const total = summary
        ? summary.updated_amount_cents / 100
        : rowTotal(row);
      return `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.voice)}</td><td>${escapeHtml(row.account)}</td><td>12 mesi</td><td class="num">${row.nature === "Ricavo" ? euro.format(total) : "—"}</td><td class="num">${row.nature === "Costo" ? euro.format(total) : "—"}</td></tr>`;
    })
    .join("");
}

export function monthlyRowsHtml(rows, rowTotal, approvedAdjustment) {
  return rows
    .map((row) => {
      const monthCells = row.values
        .map((base, index) => {
          const delta = approvedAdjustment(row.id, index);
          return `<td class="num">${euro.format(base + delta)}${delta ? `<span class="delta">rett. ${delta > 0 ? "+" : ""}${euro.format(delta)}</span>` : ""}</td>`;
        })
        .join("");
      return `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.voice)}</td><td>${escapeHtml(row.account)}</td>${monthCells}<td class="num"><strong>${euro.format(rowTotal(row))}</strong></td><td><button class="btn small" data-distribute-row="${row.id}">Ripartisci</button> <button class="btn small" data-adjust-row="${row.id}">Proponi rettifica</button></td></tr>`;
    })
    .join("");
}

export function monthlyTotalHtml(title, total) {
  return `<tr class="total-row"><td colspan="16">TOTALE COMPLESSIVO ${title}</td><td class="num">${euro.format(total)}</td><td colspan="2"></td></tr>`;
}
