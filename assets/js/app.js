import {
  clone,
  decimalInput,
  escapeHtml,
  euro,
  euroCents,
  months,
  normalizeCode,
  parseItalianAmount,
  statusClass,
} from "./core/formatters.js";
import { budgetRowsHtml } from "./components/budget-list.js";
import {
  hierarchyLevel1RowsHtml,
  hierarchyLevel2RowsHtml,
  hierarchyMonthlyRowsHtml,
  hierarchyMonthlyTotalHtml,
  levelRowsHtml,
  monthlyRowsHtml,
  monthlyTotalHtml,
  voiceRowsHtml,
} from "./components/analysis-tables.js";
import {
  ensureBudgetPlanning,
  level2Budget,
  monthlyTotal,
  planningAllYearsTotal,
  planningBaseTotal,
  planningTotal,
  planningValidation,
  planningYearMonths,
  syncSingleLevelBudgetPercentages,
  syncRedistributedBudget,
  setPlanningMonthAmount,
} from "./core/budget-hierarchy.js";
import {
  capexHeadHtml,
  capexRowsHtml,
  capexTotalHtml,
  capexTotals,
} from "./components/capex-table.js";
import { adjustmentListHtml } from "./components/adjustment-list.js";
import { distributionRowsHtml } from "./components/distribution-table.js";
import {
  annualDepreciation,
  annualPaymentSummary,
  componentSchedule,
  generateInstallments,
  scheduleTotals,
} from "./core/capex-plan.js";
import { copyBudgetWithNextVersion } from "./core/budget-versioning.js";
import {
  capexComponentsDefault,
  defaultBudgets,
  investmentDemoRows,
  ordinaryDemoRows,
} from "./data/demo-data.js";

(() => {
  "use strict";

  let ordinaryRows = load("wg-mockup-ordinary-rows", ordinaryDemoRows);
  let investmentRows = load("wg-mockup-investment-rows", investmentDemoRows);

  let budgets = load("wg-mockup-budgets", defaultBudgets);
  normalizeBudgetStates();
  let adjustments = load("wg-mockup-adjustments", [
    {
      id: "RET-0042",
      scope: "economic",
      nature: "cost",
      rowId: "c2",
      rowLabel: "Energia elettrica",
      month: 0,
      amount: 5000,
      reason: "Aumento tariffa energia",
      attachment: "preventivo.pdf",
      status: "In approvazione",
    },
    {
      id: "RET-0038",
      scope: "capex",
      nature: "cost",
      rowId: "cp2",
      rowLabel: "Impianti elettrici",
      month: 8,
      amount: 20000,
      reason: "Adeguamento quadro elettrico",
      attachment: "offerta.pdf",
      status: "Approvata",
    },
  ]);
  let capexComponents = load("wg-mockup-capex", capexComponentsDefault);
  let currentBudget = budgets[0];
  let currentChild = currentBudget.children[0];
  let analysisScope = "child";
  let currentNature = "cost";
  let editing = null;
  let editingComponentId = null;
  let capexYear = currentBudget.year;
  let monthlyYear = currentBudget.year;
  let draftSchedule = [];
  let draftManualPayments = Array(12).fill(0);
  let planDirty = false;
  let redistributionRowId = null;
  let monthlyAdjustmentsVisible = false;
  let monthlyHistory = load("wg-mockup-monthly-history", []);
  const adjustmentDrafts = new Map();
  let selectedLevel1Ids = new Set();
  let selectedLevel2Ids = new Set();
  let selectedMonthlyIds = new Set();
  let editingLevel1Ids = new Set();
  let editingLevel2Ids = new Set();
  let editingMonthlyIds = new Set();
  let apiAvailable = false;
  let apiSaveTimer = null;
  let stateVersion = 0;

  function normalizeBudgetStates() {
    budgets.forEach((budget) => {
      if (budget.state === "Attivo" || budget.state === "Disattivo") return;
      budget.state = ["Creato", "Completato"].includes(budget.state)
        ? "Attivo"
        : "Disattivo";
    });
  }

  function normalizePayments(payments) {
    if (payments?.length === 12)
      return payments.map((value) => Number(value) || 0);
    const monthly = Array(12).fill(0);
    if (payments?.length === 4)
      [2, 5, 8, 10].forEach((month, index) => {
        monthly[month] = Number(payments[index]) || 0;
      });
    return monthly;
  }

  function ensureFundingSources() {
    budgets
      .filter((budget) => budget.type === "Investimento")
      .forEach((budget) =>
        budget.children.forEach((level) => {
          if (level.fundingSource) return;
          const sources = [
            ...new Set(
              capexComponents
                .filter(
                  (component) =>
                    normalizeCode(component.project) ===
                    normalizeCode(level.code),
                )
                .map((component) => component.source?.trim())
                .filter(Boolean),
            ),
          ];
          level.fundingSource =
            sources.length === 1
              ? sources[0]
              : sources.length > 1
                ? "Fonti miste"
                : "Da definire";
        }),
      );
  }

  function ensureCompleteDemoRows() {
    [
      [ordinaryRows, ordinaryDemoRows],
      [investmentRows, investmentDemoRows],
    ].forEach(([target, source]) => {
      ["cost", "revenue"].forEach((nature) => {
        const existingIds = new Set(
          (target[nature] || []).map((row) => row.id),
        );
        target[nature] = target[nature] || [];
        source[nature].forEach((row) => {
          if (!existingIds.has(row.id)) target[nature].push(clone(row));
        });
      });
    });
    const componentIds = new Set(
      capexComponents.map((component) => component.id),
    );
    capexComponentsDefault.forEach((component) => {
      if (!componentIds.has(component.id))
        capexComponents.push(clone(component));
    });
    capexComponents.forEach((component) => {
      const canonical = capexComponentsDefault.find(
        (item) => item.id === component.id,
      );
      if (canonical?.budgetRowId && !component.budgetRowId)
        component.budgetRowId = canonical.budgetRowId;
      component.payments = normalizePayments(component.payments);
    });
    ensureFundingSources();
  }
  ensureCompleteDemoRows();

  function ensureAllBudgetPlanning() {
    budgets.forEach((budget) =>
      ensureBudgetPlanning(
        budget,
        budget.type === "Investimento"
          ? investmentRows.cost
          : ordinaryRows.cost,
      ),
    );
    const level1Catalog = new Map();
    const level2Catalog = new Map();
    budgets
      .filter((budget) => budget.type === "Ordinario")
      .forEach((budget) => {
        budget.planning.level1.forEach((level) =>
          level1Catalog.set(normalizeCode(level.code), {
            id: `catalog-l1-${normalizeCode(level.code)}`,
            code: level.code,
            name: level.name,
          }),
        );
        budget.planning.level2.forEach((level) => {
          const parent = budget.planning.level1.find(
            (item) => item.id === level.parentId,
          );
          level2Catalog.set(normalizeCode(level.code), {
            id: `catalog-l2-${normalizeCode(level.code)}`,
            parentCode: level.parentCode || parent?.code,
            code: level.code,
            name: level.name,
          });
        });
      });
    budgets
      .filter((budget) => budget.type === "Ordinario")
      .forEach((budget) => {
        budget.planning.catalog = {
          level1: [...level1Catalog.values()].map(clone),
          level2: [...level2Catalog.values()].map(clone),
        };
      });
  }
  ensureAllBudgetPlanning();

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || clone(fallback);
    } catch {
      return clone(fallback);
    }
  }
  function persist() {
    const version = ++stateVersion;
    try {
      localStorage.setItem("wg-mockup-budgets", JSON.stringify(budgets));
      localStorage.setItem(
        "wg-mockup-adjustments",
        JSON.stringify(adjustments),
      );
      localStorage.setItem("wg-mockup-monthly-history", JSON.stringify(monthlyHistory));
      localStorage.setItem("wg-mockup-capex", JSON.stringify(capexComponents));
      localStorage.setItem(
        "wg-mockup-ordinary-rows",
        JSON.stringify(ordinaryRows),
      );
      localStorage.setItem(
        "wg-mockup-investment-rows",
        JSON.stringify(investmentRows),
      );
    } catch {}
    if (apiAvailable) {
      clearTimeout(apiSaveTimer);
      apiSaveTimer = setTimeout(() => {
        fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            budgets,
            adjustments,
            monthlyHistory,
            capexComponents,
            ordinaryRows,
            investmentRows,
          }),
        })
          .then((response) => {
            if (!response.ok) toast("Salvataggio SQLite non riuscito");
            else refreshSqlSummaries(version);
          })
          .catch(() => {
            apiAvailable = false;
            toast("Connessione SQLite non disponibile");
          });
      }, 120);
    }
  }
  async function hydrateFromServer() {
    try {
      const response = await fetch("/api/state", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const state = await response.json();
      apiAvailable = true;
      if (Array.isArray(state.budgets) && state.budgets.length) {
        budgets = state.budgets;
        normalizeBudgetStates();
        adjustments = Array.isArray(state.adjustments)
          ? state.adjustments
          : adjustments;
        monthlyHistory = Array.isArray(state.monthlyHistory)
          ? state.monthlyHistory
          : monthlyHistory;
        capexComponents = Array.isArray(state.capexComponents)
          ? state.capexComponents
          : capexComponents;
        ordinaryRows = state.ordinaryRows || ordinaryRows;
        investmentRows = state.investmentRows || investmentRows;
        ensureCompleteDemoRows();
        ensureAllBudgetPlanning();
        currentBudget = budgets[0];
        currentChild = currentBudget.children[0];
        renderBudgets();
        persist();
      } else {
        persist();
      }
    } catch {
      apiAvailable = false;
    }
  }
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function showPage(name) {
    $$(".page").forEach((page) =>
      page.classList.toggle("active", page.id === `page-${name}`),
    );
    $("#page-title").textContent =
      name === "management"
        ? "Gestione Budget Analitica"
        : "Redazione Budget Analitica";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderBudgets() {
    const structure = $("#filter-structure").value;
    const status = $("#filter-status").value;
    const search = $("#budget-search").value;
    $("#budget-list").innerHTML = budgetRowsHtml(
      budgets,
      structure,
      status,
      search,
    );
  }

  function normalizeSearch(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function matchesSearch(values, search) {
    const term = normalizeSearch(search.trim());
    return (
      !term || values.some((value) => normalizeSearch(value).includes(term))
    );
  }

  function emptyTableRow(
    columns,
    label = "Nessuna riga corrisponde alla ricerca.",
  ) {
    return `<tr><td colspan="${columns}" class="center muted">${label}</td></tr>`;
  }

  function rowsForCurrent() {
    const source =
      currentBudget.type === "Investimento" ? investmentRows : ordinaryRows;
    const allowedCodes = new Set(
      (analysisScope === "child" ? [currentChild] : currentBudget.children).map(
        (child) => normalizeCode(child?.code),
      ),
    );
    return {
      cost: source.cost.filter((row) =>
        allowedCodes.has(normalizeCode(row.code)),
      ),
      revenue: source.revenue.filter((row) =>
        allowedCodes.has(normalizeCode(row.code)),
      ),
    };
  }
  function getApprovedAdjustment(rowId, month) {
    return adjustments
      .filter(
        (a) =>
          a.scope === "economic" &&
          a.rowId === rowId &&
          a.month === month &&
          a.status === "Approvata",
      )
      .reduce((sum, a) => sum + Number(a.amount), 0);
  }
  function rowTotal(row) {
    return row.values.reduce(
      (sum, value, index) => sum + value + getApprovedAdjustment(row.id, index),
      0,
    );
  }

  function planningLevel(id) {
    const planning = currentBudget.planning;
    return (planning.mode === "single-level" ? planning.level1 : planning.level2)
      .find((level) => level.id === id);
  }

  function planningAdjustment(levelId, month, year = monthlyYear) {
    const result = adjustments
      .filter((item) => item.scope === "planning" && item.budgetId === currentBudget.id && item.rowId === levelId && item.month === month && Number(item.year ?? currentBudget.year) === Number(year))
      .reduce((totals, item) => {
        if (item.status === "Approvata") totals.approved += Number(item.amount);
        if (item.status === "Bozza") totals.draft += Number(item.amount);
        if (item.status === "In approvazione") {
          totals.pending += Number(item.amount);
          totals.hasPending = true;
        }
        if (item.status === "Bozza" && !totals.reason) totals.reason = item.reason || "";
        return totals;
      }, { approved: 0, draft: 0, pending: 0, hasPending: false, reason: "" });
    const key = `${currentBudget.id}:${levelId}:${year}:${month}`;
    if (adjustmentDrafts.has(key)) result.draftValue = adjustmentDrafts.get(key).raw;
    return result;
  }

  function openAnalysis(budgetId) {
    currentBudget = budgets.find((b) => b.id === budgetId) || budgets[0];
    currentChild = currentBudget.children[0];
    analysisScope = "budget";
    selectedLevel1Ids = new Set();
    selectedLevel2Ids = new Set();
    selectedMonthlyIds = new Set();
    editingLevel1Ids = new Set();
    editingLevel2Ids = new Set();
    editingMonthlyIds = new Set();
    ensureBudgetPlanning(
      currentBudget,
      currentBudget.type === "Investimento"
        ? investmentRows.cost
        : ordinaryRows.cost,
    );
    ["level-search", "voice-search", "monthly-search", "capex-search"].forEach(
      (id) => {
        $(`#${id}`).value = "";
      },
    );
    $("#analysis-name").textContent = currentBudget.name;
    $("#analysis-code").textContent = `Budget ${currentBudget.name}`;
    $("#analysis-period").textContent = currentBudget.year;
    capexYear = currentBudget.year;
    monthlyYear = currentBudget.year;
    $("#analysis-status").textContent = currentBudget.state;
    $("#analysis-status").className =
      `status ${statusClass(currentBudget.state)}`;
    $("#analysis-type").value = currentBudget.type;
    $("#analysis-budget-field").innerHTML = budgets
      .filter((budget) => budget.type === currentBudget.type)
      .map(
        (budget) =>
          `<option value="${escapeHtml(budget.id)}">${escapeHtml(budget.name)} ${budget.year} · Versione ${budget.version}</option>`,
      )
      .join("");
    $("#analysis-budget-field").value = currentBudget.id;
    $("#analysis-structure-field").value =
      currentBudget.associatedStructure || currentBudget.name;
    $("#analysis-frequency").value =
      currentBudget.frequency === "Vita utile"
        ? "Annuale"
        : currentBudget.frequency;
    $("#analysis-duration").value = "12 mesi (anno)";
    $("#monthly-panel").hidden = false;
    $("#capex-panel").hidden = true;
    renderAnalysis();
    showPage("analysis");
  }

  function renderAnalysis() {
    const planning = currentBudget.planning;
    $("#level2-panel").hidden = planning.mode === "single-level";
    $("#level1-panel").classList.toggle("panel-wide", planning.mode === "single-level");
    const validation = planningValidation(planning);
    $("#distribute-l1").disabled = planning.level1.length === 0;
    $("#distribute-l2").hidden = planning.mode === "single-level";
    $("#distribute-l2").disabled =
      planning.mode === "single-level" || planning.level2.length === 0;
    const levelSearch = $("#level-search").value;
    const level2Search = $("#voice-search").value;
    const visibleLevel1 = planning.level1.filter((level) =>
      matchesSearch([level.code, level.name], levelSearch),
    );
    const visibleLevel2 = planning.level2.filter(
      (level) =>
        (!selectedLevel1Ids.size || selectedLevel1Ids.has(level.parentId)) &&
        matchesSearch([level.code, level.name], level2Search),
    );
    $("#level-head").innerHTML =
      '<th>Codice</th><th>Descrizione</th><th class="num">Budget</th><th class="num">% sul totale</th><th>Azioni</th>';
    $("#level-table").innerHTML = hierarchyLevel1RowsHtml(
      planning,
      validation,
      visibleLevel1,
      selectedLevel1Ids,
      editingLevel1Ids,
    );
    $("#voice-table").innerHTML = hierarchyLevel2RowsHtml(
      planning,
      validation,
      visibleLevel2,
      selectedLevel2Ids,
      editingLevel2Ids,
    );
    const allocationPercent = planning.level1.reduce(
      (sum, level) => sum + Number(level.totalPercent || 0),
      0,
    );
    const allocationDelta = allocationPercent - 100;
    const allocationMessage = $("#level1-allocation-message");
    if (Math.abs(allocationDelta) > 0.005) {
      const amountDelta = Math.abs(planningBaseTotal(planning) * allocationDelta / 100);
      allocationMessage.hidden = false;
      allocationMessage.classList.toggle("over", allocationDelta > 0);
      allocationMessage.textContent = allocationDelta > 0
        ? `Percentuali Livello 1: ${allocationPercent.toFixed(2)}% — superi il totale di ${euro.format(amountDelta)}. Riduci le quote che vuoi: le altre non cambiano.`
        : `Percentuali Livello 1: ${allocationPercent.toFixed(2)}% — resta da assegnare ${Math.abs(allocationDelta).toFixed(2)}% (${euro.format(amountDelta)}). Puoi completare la ripartizione sulle altre righe.`;
    } else {
      allocationMessage.hidden = true;
      allocationMessage.classList.remove("over");
    }
    const level2Message = $("#level2-allocation-message");
    const level2Issues = [];
    planning.level1.forEach((parent) => {
      const children = planning.level2.filter((level) => level.parentId === parent.id);
      if (!children.length) return;
      const sum = children.reduce((total, level) => total + Number(level.totalPercent || 0), 0);
      const expected = Number(parent.totalPercent ?? (planningBaseTotal(planning) > 0 ? Number(parent.budget || 0) / planningBaseTotal(planning) * 100 : 0));
      const delta = sum - expected;
      if (Math.abs(delta) <= 0.005) return;
      const amount = Math.abs(planningBaseTotal(planning) * delta / 100);
      level2Issues.push(delta > 0
        ? `${parent.code} · ${parent.name}: i figli superano la quota del padre di ${delta.toFixed(2)} punti (${euro.format(amount)}). Riduci le percentuali sul totale.`
        : `${parent.code} · ${parent.name}: ai figli manca ${Math.abs(delta).toFixed(2)}% (${euro.format(amount)}) per quadrarsi con il budget del padre.`);
    });
    if (validation.level2TotalPercentError) {
      const delta = validation.level2TotalPercent - 100;
      const amount = Math.abs(planningBaseTotal(planning) * delta / 100);
      level2Issues.push(delta > 0
        ? `% sul totale: superi il 100% di ${delta.toFixed(2)} punti (${euro.format(amount)}).`
        : `% sul totale: manca ${Math.abs(delta).toFixed(2)}% (${euro.format(amount)}) per arrivare al 100%.`);
    }
    level2Message.hidden = level2Issues.length === 0;
    level2Message.classList.toggle("over", level2Issues.some((message) => message.includes("superi")));
    level2Message.textContent = level2Issues.join(" ");
    renderPlanningCrudControls();
    renderMonthly();
    renderAdjustments();
  }

  function renderPlanningCrudControls() {
    const planning = currentBudget.planning;
    $("#add-l1").disabled = false;
    $("#add-l2").disabled = planning.mode === "single-level" || !planning.level1.length;
    $("#add-monthly").disabled = planning.mode !== "single-level" && !planning.level1.length;
  }

  async function refreshSqlSummaries(version = stateVersion) {
    void version;
  }

  function renderMonthly() {
    const planning = currentBudget.planning;
    const investment = currentBudget.type === "Investimento";
    $("#adjustment-help").hidden = !monthlyAdjustmentsVisible;
    $("#monthly-panel table").classList.toggle("adjustment-mode", monthlyAdjustmentsVisible);
    $("#monthly-year-label").hidden = !investment;
    $("#monthly-year").hidden = !investment;
    if (investment) {
      const years = new Set([currentBudget.year, monthlyYear]);
      planning.level1.forEach((level) => Object.keys(level.yearMonths || {}).forEach((year) => years.add(Number(year))));
      $("#monthly-year").innerHTML = [...years].sort((a, b) => a - b)
        .map((year) => `<option value="${year}">${year}</option>`).join("");
      $("#monthly-year").value = String(monthlyYear);
    }
    const validation = planningValidation(planning);
    const search = $("#monthly-search").value;
    const levels =
      planning.mode === "single-level" ? planning.level1 : planning.level2;
    const targetIds =
      planning.mode === "single-level"
        ? selectedLevel1Ids
        : selectedLevel2Ids;
    const visibleLevels = levels.filter(
      (level) =>
        (!targetIds.size || targetIds.has(level.id)) &&
        matchesSearch([level.code, level.name], search),
    );
    $("#grand-total").textContent =
      `TOTALE BUDGET: ${euro.format(planningTotal(planning))}`;
    $("#monthly-head").innerHTML = `<th>Codice</th><th>Descrizione</th>${months.map((month) => `<th>${month}</th>${monthlyAdjustmentsVisible ? `<th class="adjustment-head">Rett. ${month}</th>` : ""}`).join("")}<th class="num">${investment ? `Totale ${monthlyYear}` : "Totale base"}</th>${monthlyAdjustmentsVisible ? '<th class="num">Rettifiche</th><th class="num">Budget aggiornato</th>' : ""}<th class="num">${investment ? "Differenza piano" : "Differenza"}</th><th>Azioni</th>`;
    $("#monthly-table").innerHTML = hierarchyMonthlyRowsHtml(
      planning,
      validation,
      visibleLevels,
      selectedMonthlyIds,
      editingMonthlyIds,
      monthlyAdjustmentsVisible,
      planningAdjustment,
      monthlyYear,
    );
    if (!visibleLevels.length) {
      $("#monthly-table").innerHTML =
        `<tr><td colspan="${monthlyAdjustmentsVisible ? 31 : 17}" class="center muted">Nessuna pianificazione disponibile.</td></tr>`;
    }
    $("#monthly-foot").innerHTML =
      hierarchyMonthlyTotalHtml(planning, visibleLevels, monthlyAdjustmentsVisible, planningAdjustment, monthlyYear);
    updateAdjustmentSubmitButton();
    if (!$("#monthly-history").hidden) renderMonthlyHistory();
  }

  function adjustmentDraftKey(levelId, month, year = monthlyYear) {
    return `${currentBudget.id}:${levelId}:${year}:${month}`;
  }

  function currentAdjustmentDrafts() {
    return [...adjustmentDrafts.values()].filter(
      (draft) => draft.budgetId === currentBudget.id && draft.year === monthlyYear,
    );
  }

  function updateAdjustmentSubmitButton() {
    const button = $("#submit-monthly-adjustments");
    button.hidden = !monthlyAdjustmentsVisible;
    const count = currentAdjustmentDrafts().length;
    button.textContent = count ? `Invia rettifica (${count})` : "Invia rettifica";
    button.title = count ? "Apri il box per motivare e inviare la richiesta" : "Modifica prima almeno una cella nelle colonne Rett.";
    button.disabled = count === 0;
  }

  function collectAdjustmentChanges() {
    const changes = [];
    for (const draft of currentAdjustmentDrafts()) {
      const level = planningLevel(draft.levelId);
      if (!level || planningAdjustment(level.id, draft.month, draft.year).hasPending) {
        return { error: "Una voce modificata non è più disponibile o ha già una rettifica in approvazione." };
      }
      const proposed = parseItalianAmount(draft.raw);
      const base = currentBudget.type === "Investimento"
        ? planningYearMonths(level, draft.year, currentBudget.year)[draft.month]
        : level.months[draft.month];
      if (proposed == null ||
        Math.round((Number(base) + proposed) * 100) < 0) {
        return { error: `Valore non valido per ${level.name}, ${months[draft.month]}: usa il formato italiano (es. 1.000,50) e mantieni il budget non negativo.` };
      }
      const approved = planningAdjustment(level.id, draft.month, draft.year).approved;
      const amountCents = Math.round(proposed * 100) - Math.round(approved * 100);
      if (amountCents) changes.push({ level, year: draft.year, month: draft.month, before: approved, after: Math.round(proposed * 100) / 100, amount: amountCents / 100 });
    }
    return { changes };
  }

  function createMonthlySnapshot(requestId, reason, createdAt, changes) {
    const planning = currentBudget.planning;
    const levels = planning.mode === "single-level" ? planning.level1 : planning.level2;
    return {
      id: requestId,
      budgetId: currentBudget.id,
      budgetName: currentBudget.name,
      year: monthlyYear,
      createdAt,
      reason,
      changes: changes.map(({ level, month, before, after }) => ({ levelId: level.id, month, before, after })),
      rows: levels.filter((level) => level.monthlyActive !== false).map((level) => {
        const base = planning.mode === "single-level"
          ? planningYearMonths(level, monthlyYear, currentBudget.year)
          : level.months;
        const values = base.map((value, month) => {
          const change = changes.find((item) => item.level.id === level.id && item.month === month);
          return Math.round((Number(value) + (change ? change.after : planningAdjustment(level.id, month).approved)) * 100) / 100;
        });
        return { id: level.id, code: level.code, name: level.name, values };
      }),
    };
  }

  function renderMonthlyHistory() {
    const entries = monthlyHistory.filter((entry) => entry.budgetId === currentBudget.id);
    $("#monthly-history").innerHTML = entries.length ? entries.map((entry) => {
      const status = adjustments.find((item) => item.requestId === entry.id)?.status || "In approvazione";
      const rows = entry.rows.map((row) => {
        const values = row.values.map((value, month) => {
          const changed = entry.changes.some((item) => item.levelId === row.id && item.month === month);
          return `<td class="num${changed ? " history-changed" : ""}">${euroCents.format(value)}</td>`;
        }).join("");
        const total = row.values.reduce((sum, value) => sum + Number(value), 0);
        return `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.name)}</td>${values}<td class="num">${euroCents.format(total)}</td></tr>`;
      }).join("");
      return `<details class="monthly-history-entry"><summary>${escapeHtml(new Date(entry.createdAt).toLocaleString("it-IT"))} · ${escapeHtml(entry.year)} · ${escapeHtml(status)} · ${escapeHtml(entry.reason)}</summary><p>Versione della tabella 3 proposta con la richiesta ${escapeHtml(entry.id)}. Le celle evidenziate sono state rettificate.</p><div class="table-wrap"><table><thead><tr><th>Codice</th><th>Descrizione</th>${months.map((month) => `<th>${month}</th>`).join("")}<th>Totale</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
    }).join("") : '<p class="muted">Nessuna versione salvata della tabella 3 per questo budget.</p>';
  }

  function capexForCurrent() {
    if (currentBudget.type !== "Investimento") return [];
    const allowedProjects = new Set(
      (analysisScope === "child" ? [currentChild] : currentBudget.children).map(
        (child) => normalizeCode(child?.code),
      ),
    );
    return capexComponents.filter((component) => {
      const isEmptyPlaceholder =
        component.component === "Nuovo componente" &&
        component.approved === 0 &&
        component.adjustment === 0 &&
        component.payments.every((value) => value === 0);
      return (
        allowedProjects.has(normalizeCode(component.project)) &&
        !isEmptyPlaceholder
      );
    });
  }

  function renderCapex() {
    const allComponents = capexForCurrent();
    const visibleComponents = allComponents.filter((component) =>
      matchesSearch(
        [
          component.project,
          component.component,
          component.source,
          component.paymentMode,
          component.life,
          component.state,
        ],
        $("#capex-search").value,
      ),
    );
    const years = [currentBudget.year];
    allComponents.forEach((component) => {
      componentSchedule(component, currentBudget.year).forEach((payment) =>
        years.push(Number(payment.date.slice(0, 4))),
      );
      if (component.inServiceDate) {
        const startYear = Number(component.inServiceDate.slice(0, 4));
        const startMonth = Number(component.inServiceDate.slice(5, 7));
        years.push(
          startYear + Number(component.life) - (startMonth === 1 ? 1 : 0),
        );
      }
    });
    const firstYear = Math.min(...years);
    const lastYear = Math.max(...years);
    if (capexYear < firstYear || capexYear > lastYear)
      capexYear = currentBudget.year;
    $("#capex-year").innerHTML = Array.from(
      { length: lastYear - firstYear + 1 },
      (_, index) => firstYear + index,
    )
      .map((year) => `<option value="${year}">${year}</option>`)
      .join("");
    $("#capex-year").value = String(capexYear);
    $("#capex-scope-label").textContent =
      analysisScope === "budget"
        ? `Commesse di ${currentBudget.name}`
        : `${currentChild.code} · ${currentChild.name}`;
    const totals = capexTotals(
      visibleComponents,
      capexYear,
      currentBudget.year,
    );
    $("#capex-head").innerHTML = capexHeadHtml(capexYear);
    $("#capex-table").innerHTML = visibleComponents.length
      ? capexRowsHtml(visibleComponents, capexYear, currentBudget.year)
      : emptyTableRow(24);
    $("#capex-foot").innerHTML = capexTotalHtml(totals);
    $("#capex-year-summary").textContent =
      `Uscite ${euro.format(totals.annualCash)} · capitale residuo ${euro.format(totals.remainingPrincipal)}`;
  }

  function openVoiceModal() {
    const levels =
      analysisScope === "budget" ? currentBudget.children : [currentChild];
    $("#voice-form").reset();
    $("#voice-level").innerHTML = levels
      .map(
        (level) =>
          `<option value="${escapeHtml(level.code)}">${escapeHtml(level.code)} · ${escapeHtml(level.name)}</option>`,
      )
      .join("");
    $("#voice-nature").value = currentNature;
    $("#voice-description").setCustomValidity("");
    $("#voice-account").setCustomValidity("");
    $("#voice-investment-note").hidden = currentBudget.type !== "Investimento";
    updateVoiceAccounts();
    updateVoicePreview();
    $("#voice-modal").classList.add("open");
    $("#voice-modal").setAttribute("aria-hidden", "false");
  }

  function closeVoiceModal() {
    $("#voice-modal").classList.remove("open");
    $("#voice-modal").setAttribute("aria-hidden", "true");
  }

  function updateVoiceAccounts() {
    const nature = $("#voice-nature").value;
    const accounts = [
      ...new Set(
        [...ordinaryRows[nature], ...investmentRows[nature]].map(
          (row) => row.account,
        ),
      ),
    ].sort();
    $("#voice-accounts").innerHTML = accounts
      .map((account) => `<option value="${escapeHtml(account)}"></option>`)
      .join("");
  }

  function scheduledMonths() {
    const start = Number($("#voice-start-month").value);
    const interval = Number($("#voice-frequency").value);
    const months = [];
    for (let month = start; month < 12; month += interval || 12)
      months.push(month);
    return months;
  }

  function updateVoicePreview() {
    const amount = Number($("#voice-total").value || 0);
    const count = scheduledMonths().length;
    $("#voice-preview").textContent =
      amount > 0
        ? `${euro.format(amount)} ripartiti in ${count} ${count === 1 ? "scadenza" : "scadenze"} nel ${currentBudget.year}. Dopo il salvataggio puoi modificare i mesi con “Ripartisci”.`
        : "Inserisci l’importo: la ripartizione apparirà nella tabella 3.";
  }

  function addBudgetVoice(event) {
    event.preventDefault();
    const level = currentBudget.children.find(
      (child) => child.code === $("#voice-level").value,
    );
    if (!level) return;
    const source =
      currentBudget.type === "Investimento" ? investmentRows : ordinaryRows;
    const nature = $("#voice-nature").value;
    const voice = $("#voice-description").value.trim();
    const account = $("#voice-account").value.trim();
    const totalCents = Math.round(Number($("#voice-total").value) * 100);
    if (!voice) {
      $("#voice-description").setCustomValidity(
        "Inserisci il nome della voce.",
      );
      $("#voice-description").reportValidity();
      return;
    }
    if (!account) {
      $("#voice-account").setCustomValidity(
        "Seleziona o inserisci un sottoconto.",
      );
      $("#voice-account").reportValidity();
      return;
    }
    const allRows = [ordinaryRows, investmentRows];
    if (
      allRows.some((rows) =>
        rows[nature === "cost" ? "revenue" : "cost"].some(
          (row) => row.account === account,
        ),
      )
    ) {
      $("#voice-account").setCustomValidity(
        "Questo sottoconto è già usato con la natura opposta.",
      );
      $("#voice-account").reportValidity();
      return;
    }
    if (
      source[nature].some(
        (row) =>
          normalizeCode(row.code) === normalizeCode(level.code) &&
          row.account === account &&
          row.voice.toLowerCase() === voice.toLowerCase(),
      )
    ) {
      $("#voice-description").setCustomValidity(
        "Questa voce con lo stesso sottoconto esiste già nel livello.",
      );
      $("#voice-description").reportValidity();
      return;
    }
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return;
    const months = scheduledMonths();
    const values = Array(12).fill(0);
    const baseCents = Math.floor(totalCents / months.length);
    const remainder = totalCents % months.length;
    months.forEach((month, index) => {
      values[month] = (baseCents + (index < remainder ? 1 : 0)) / 100;
    });
    source[nature].push({
      id: `voice-${crypto.randomUUID()}`,
      code: level.code,
      description: level.name,
      voice,
      account,
      values,
    });
    currentNature = nature;
    renderAnalysis();
    persist();
    closeVoiceModal();
    toast(
      `${nature === "cost" ? "Costo" : "Ricavo"} aggiunto: tabelle e totali aggiornati`,
    );
  }

  function updateComponentPreview() {
    const amount = Number($("#component-amount").value || 0);
    const adjustment = Number($("#component-adjustment").value || 0);
    const updated = amount + adjustment;
    const mode = $("#component-payment-mode").value;
    $("#component-updated").value = updated.toFixed(2);
    const serviceDate = $("#component-service-date").value;
    $("#component-depreciation").readOnly = Boolean(serviceDate);
    if (serviceDate) {
      $("#component-depreciation").value = annualDepreciation(
        {
          approved: amount,
          adjustment,
          life: Number($("#component-life").value),
          inServiceDate: serviceDate,
        },
        currentBudget.year,
        currentBudget.year,
      ).toFixed(2);
    }
    if (mode === "manuale") {
      const planned = draftManualPayments.reduce(
        (sum, value) => sum + Math.round(value * 100),
        0,
      );
      const difference = Math.round(updated * 100) - planned;
      $("#component-payment-summary").textContent =
        `Pagamenti ${currentBudget.year}: ${euro.format(planned / 100)} di ${euro.format(updated)} · Differenza: ${euro.format(difference / 100)}`;
      $("#component-payment-summary").classList.toggle(
        "invalid",
        difference !== 0,
      );
    } else {
      const totals = scheduleTotals(draftSchedule);
      const difference = Math.round(updated * 100) - totals.principal;
      const year = Number(
        $("#component-plan-year").value || currentBudget.year,
      );
      const annual = annualPaymentSummary(
        {
          approved: amount,
          adjustment,
          paymentSchedule: draftSchedule,
          payments: [],
        },
        year,
        currentBudget.year,
      );
      $("#component-payment-summary").textContent = planDirty
        ? "Piano da generare: premi “Genera piano rate” dopo aver completato i parametri."
        : `Intero piano: capitale ${euro.format(totals.principal / 100)} · interessi ${euro.format(totals.interest / 100)} · uscite ${year}: ${euro.format(annual.cashTotal)} · capitale da pianificare: ${euro.format(difference / 100)}`;
      $("#component-payment-summary").classList.toggle(
        "invalid",
        planDirty || difference !== 0,
      );
    }
    $("#component-amount").setCustomValidity("");
  }

  function renderComponentPaymentFields(selectedYear = currentBudget.year) {
    const mode = $("#component-payment-mode").value;
    const years =
      mode === "manuale"
        ? [currentBudget.year]
        : [
            ...new Set([
              currentBudget.year,
              ...draftSchedule.map((payment) =>
                Number(payment.date.slice(0, 4)),
              ),
            ]),
          ].sort((a, b) => a - b);
    $("#component-plan-year").innerHTML = years
      .map((year) => `<option value="${year}">${year}</option>`)
      .join("");
    $("#component-plan-year").value = String(
      years.includes(selectedYear) ? selectedYear : currentBudget.year,
    );
    const annual =
      mode === "manuale"
        ? draftManualPayments
        : annualPaymentSummary(
            {
              approved: Number($("#component-amount").value || 0),
              adjustment: Number($("#component-adjustment").value || 0),
              paymentSchedule: draftSchedule,
              payments: [],
            },
            Number($("#component-plan-year").value),
            currentBudget.year,
          ).cash;
    $("#component-payment-fields").innerHTML = months
      .map(
        (month, index) =>
          `<div class="field"><label for="payment-${index}">${month} (€)</label><input id="payment-${index}" data-payment-month="${index}" type="number" min="0" step="0.01" value="${annual[index] || 0}" ${mode === "manuale" ? "required" : "readonly"}></div>`,
      )
      .join("");
    updateComponentPreview();
  }

  function updateComponentPlanMode() {
    const mode = $("#component-payment-mode").value;
    const automatic = mode !== "manuale";
    $("#component-plan-settings").hidden = !automatic;
    $("#component-interest-field").hidden = mode !== "finanziamento";
    $("#component-interest").disabled = mode !== "finanziamento";
    $("#component-first-due").required = automatic;
    $("#component-installments").required = automatic;
    $("#component-plan-help").textContent =
      mode === "finanziamento"
        ? "La macchina entra nel budget alla data investimento. I mesi qui sotto mostrano i rimborsi alla banca: capitale e interessi sono separati nel piano; gli interessi non aumentano il CAPEX. Il pagamento al fornitore è previsto alla data investimento."
        : mode === "fornitore"
          ? "I mesi mostrano le rate pagate al fornitore. La somma del capitale di tutti gli anni deve coincidere con il CAPEX aggiornato."
          : "Inserisci gli importi nei dodici mesi. La loro somma deve coincidere con il CAPEX aggiornato.";
    renderComponentPaymentFields(
      Number($("#component-plan-year").value || currentBudget.year),
    );
  }

  function generateComponentPlan() {
    const amount =
      Number($("#component-amount").value || 0) +
      Number($("#component-adjustment").value || 0);
    try {
      draftSchedule = generateInstallments({
        mode: $("#component-payment-mode").value,
        amount,
        firstDate: $("#component-first-due").value,
        count: Number($("#component-installments").value),
        intervalMonths: Number($("#component-interval").value),
        annualRate: Number($("#component-interest").value || 0),
      });
    } catch (error) {
      $("#component-first-due").setCustomValidity(error.message);
      $("#component-first-due").reportValidity();
      return;
    }
    planDirty = false;
    $("#component-first-due").setCustomValidity("");
    renderComponentPaymentFields(
      Number($("#component-plan-year").value || currentBudget.year),
    );
  }

  function scaleMonthlyValues(values, targetCents) {
    const original = values.map((value) =>
      Math.round(Number(value || 0) * 100),
    );
    const originalTotal = original.reduce((sum, value) => sum + value, 0);
    if (!originalTotal) {
      const next = Array(values.length).fill(0);
      next[0] = targetCents / 100;
      return next;
    }
    const fractions = original.map((value, index) => ({
      index,
      exact: (value * targetCents) / originalTotal,
    }));
    const nextCents = fractions.map((item) => Math.floor(item.exact));
    let remaining =
      targetCents - nextCents.reduce((sum, value) => sum + value, 0);
    fractions.sort(
      (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)),
    );
    for (let index = 0; index < remaining; index++)
      nextCents[fractions[index].index]++;
    return nextCents.map((value) => value / 100);
  }

  function openComponentModal(
    componentId = null,
    selectedYear = currentBudget.year,
  ) {
    const projects =
      analysisScope === "budget" ? currentBudget.children : [currentChild];
    const component = componentId
      ? capexForCurrent().find((item) => item.id === componentId)
      : null;
    if (componentId && !component) return;
    const linkedRow =
      component &&
      investmentRows.cost.find((row) => row.id === component.budgetRowId);
    if (component && !linkedRow) {
      toast("Voce di budget collegata non trovata: modifica non disponibile");
      return;
    }
    editingComponentId = component?.id || null;
    $("#component-form").reset();
    $("#component-project").innerHTML = projects
      .map(
        (project) =>
          `<option value="${escapeHtml(project.code)}">${escapeHtml(project.code)} · ${escapeHtml(project.name)}</option>`,
      )
      .join("");
    $("#component-modal-title").textContent = component
      ? `Modifica voce CAPEX · ${component.component}`
      : "Nuova voce CAPEX";
    $("#component-submit").textContent = component
      ? "Salva modifiche"
      : "Aggiungi voce";
    $("#component-project").value =
      component?.project || projects[0]?.code || "";
    $("#component-description").value = component?.component || "";
    $("#component-account").value = linkedRow?.account || "";
    $("#component-source").value = component?.source || "";
    $("#component-life").value = component?.life || "";
    $("#component-state").value = component?.state || "Pianificato";
    $("#component-purchase-date").value =
      component?.purchaseDate || `${currentBudget.year}-01-01`;
    $("#component-service-date").value =
      component?.inServiceDate ||
      (component ? "" : `${currentBudget.year}-01-01`);
    $("#component-amount").value = component?.approved ?? "";
    $("#component-adjustment").value = component?.adjustment || 0;
    $("#component-depreciation").value = component?.depreciation ?? 0;
    $("#component-payment-mode").value =
      component?.paymentMode || (component ? "manuale" : "fornitore");
    $("#component-first-due").value =
      component?.firstDueDate || `${currentBudget.year}-01-01`;
    $("#component-installments").value = component?.installments || 120;
    $("#component-interval").value = component?.intervalMonths || 1;
    $("#component-interest").value = component?.annualRate || 0;
    draftSchedule = Array.isArray(component?.paymentSchedule)
      ? clone(component.paymentSchedule)
      : [];
    draftManualPayments = normalizePayments(component?.payments);
    planDirty =
      $("#component-payment-mode").value !== "manuale" && !draftSchedule.length;
    $("#component-amount").setCustomValidity("");
    $("#component-description").setCustomValidity("");
    $("#component-account").setCustomValidity("");
    $("#component-first-due").setCustomValidity("");
    updateComponentPlanMode();
    renderComponentPaymentFields(selectedYear);
    $("#component-modal").classList.add("open");
    $("#component-modal").setAttribute("aria-hidden", "false");
  }

  function closeComponentModal() {
    $("#component-modal").classList.remove("open");
    $("#component-modal").setAttribute("aria-hidden", "true");
    editingComponentId = null;
  }

  function saveInvestmentComponent(event) {
    event.preventDefault();
    const project = currentBudget.children.find(
      (child) => child.code === $("#component-project").value,
    );
    if (!project) return;
    const component = editingComponentId
      ? capexComponents.find((item) => item.id === editingComponentId)
      : null;
    const linkedRow =
      component &&
      investmentRows.cost.find((row) => row.id === component.budgetRowId);
    if (editingComponentId && (!component || !linkedRow)) {
      toast("Voce di budget collegata non trovata");
      return;
    }
    const description = $("#component-description").value.trim();
    const account = $("#component-account").value.trim();
    const amount = Number($("#component-amount").value);
    const adjustment = component ? Number(component.adjustment || 0) : 0;
    const mode = $("#component-payment-mode").value;
    const purchaseDate = $("#component-purchase-date").value;
    if (Number(purchaseDate.slice(0, 4)) !== currentBudget.year) {
      $("#component-purchase-date").setCustomValidity(
        `La data investimento deve essere nell'anno del budget (${currentBudget.year}).`,
      );
      $("#component-purchase-date").reportValidity();
      return;
    }
    const duplicate = investmentRows.cost.some(
      (row) =>
        normalizeCode(row.code) === normalizeCode(project.code) &&
        row.id !== linkedRow?.id &&
        row.account === account &&
        row.voice.toLowerCase() === description.toLowerCase(),
    );
    if (duplicate) {
      $("#component-description").setCustomValidity(
        "Questa voce con lo stesso sottoconto esiste già nella commessa.",
      );
      $("#component-description").reportValidity();
      return;
    }
    if (
      [ordinaryRows, investmentRows].some((rows) =>
        rows.revenue.some((row) => row.account === account),
      )
    ) {
      $("#component-account").setCustomValidity(
        "Questo sottoconto è già usato per un ricavo.",
      );
      $("#component-account").reportValidity();
      return;
    }
    const updatedCents = Math.round((amount + adjustment) * 100);
    const plannedPrincipalCents =
      mode === "manuale"
        ? draftManualPayments.reduce(
            (sum, value) => sum + Math.round(value * 100),
            0,
          )
        : scheduleTotals(draftSchedule).principal;
    if (
      updatedCents <= 0 ||
      planDirty ||
      plannedPrincipalCents !== updatedCents
    ) {
      $("#component-amount").setCustomValidity(
        mode === "manuale"
          ? "La somma dei dodici mesi deve coincidere con il CAPEX aggiornato."
          : "Genera il piano: il capitale di tutte le rate deve coincidere con il CAPEX aggiornato.",
      );
      $("#component-amount").reportValidity();
      return;
    }
    const payments =
      mode === "manuale"
        ? draftManualPayments.slice()
        : annualPaymentSummary(
            {
              approved: amount,
              adjustment,
              paymentSchedule: draftSchedule,
              payments: [],
            },
            currentBudget.year,
            currentBudget.year,
          ).cash;
    const row = linkedRow || { id: `ic${crypto.randomUUID()}` };
    const approvedEconomicCents = linkedRow
      ? Array.from({ length: 12 }, (_, month) =>
          getApprovedAdjustment(linkedRow.id, month),
        ).reduce((sum, value) => sum + Math.round(value * 100), 0)
      : 0;
    const targetBaseCents = updatedCents - approvedEconomicCents;
    if (targetBaseCents < 0) {
      $("#component-amount").setCustomValidity(
        "Il CAPEX aggiornato non può essere inferiore alle rettifiche economiche già approvate.",
      );
      $("#component-amount").reportValidity();
      return;
    }
    const values = linkedRow
      ? scaleMonthlyValues(linkedRow.values, targetBaseCents)
      : Array.from({ length: 12 }, (_, month) =>
          month === Number(purchaseDate.slice(5, 7)) - 1
            ? targetBaseCents / 100
            : 0,
        );
    Object.assign(row, {
      code: project.code,
      description: project.name,
      voice: description,
      account,
      values,
    });
    if (!linkedRow) investmentRows.cost.push(row);
    const capex = component || {
      id: `cp${crypto.randomUUID()}`,
      budgetRowId: row.id,
      adjustment: 0,
    };
    Object.assign(capex, {
      project: project.code,
      component: description,
      category: component?.category || "Da definire",
      source: $("#component-source").value.trim(),
      life: Number($("#component-life").value),
      state: $("#component-state").value,
      purchaseDate,
      inServiceDate: $("#component-service-date").value,
      paymentMode: mode,
      firstDueDate: mode === "manuale" ? null : $("#component-first-due").value,
      installments:
        mode === "manuale" ? null : Number($("#component-installments").value),
      intervalMonths:
        mode === "manuale" ? null : Number($("#component-interval").value),
      annualRate:
        mode === "finanziamento" ? Number($("#component-interest").value) : 0,
      paymentSchedule: mode === "manuale" ? [] : clone(draftSchedule),
      payments,
      approved: amount,
      depreciation: Number($("#component-depreciation").value),
    });
    if (!component) capexComponents.push(capex);
    persist();
    renderAnalysis();
    closeComponentModal();
    toast(
      component
        ? "Componente e totali del budget aggiornati"
        : "Voce di investimento aggiunta al budget e al dettaglio CAPEX",
    );
  }

  function openEdit(type, budgetId) {
    const budget = budgets.find((b) => b.id === budgetId);
    editing = { type, budgetId };
    $("#edit-modal-title").textContent =
      type === "new" ? "Crea nuovo budget" : `Modifica budget ${budget.name}`;
    const associatedStructure = budget?.associatedStructure || "";
    const associatedStructures = ["Struttura 1", "Struttura 2", "Struttura 3"];
    const legacyStructureOption =
      associatedStructure && !associatedStructures.includes(associatedStructure)
        ? `<option value="${escapeHtml(associatedStructure)}" selected>${escapeHtml(associatedStructure)}</option>`
        : "";
    $("#edit-modal-body").innerHTML = `
      <div class="field"><label for="edit-year">Anno</label><input id="edit-year" name="year" type="number" value="${budget?.year || 2027}" required></div>
      <div class="field"><label for="edit-name">Nome budget</label><input id="edit-name" name="name" value="${escapeHtml(budget?.name || "NUOVO BUDGET")}" required></div>
      <div class="field"><label for="edit-version">Versione</label><input id="edit-version" name="version" type="number" value="${budget?.version || 1}" required></div>
      <div class="field"><label for="edit-revision">Revisione</label><input id="edit-revision" name="revision" type="number" value="${budget?.revision || 0}" required></div>
      <div class="field"><label for="edit-frequency">Periodicità</label><select id="edit-frequency" name="frequency"><option>Annuale</option><option>Mensile</option><option>Trimestrale</option><option>Vita utile</option></select></div>
      <div class="field"><label for="edit-type">Tipo budget</label><select id="edit-type" name="budgetType"><option>Ordinario</option><option>Investimento</option></select></div>
      <div class="field full"><label for="edit-associated-structure">Struttura analitica associata</label><select id="edit-associated-structure" name="associatedStructure"><option value="">Seleziona una struttura</option>${associatedStructures.map((structure) => `<option value="${structure}">${structure}</option>`).join("")}${legacyStructureOption}</select></div>
      <div class="field"><label for="edit-state">Stato</label><select id="edit-state" name="state"><option>Attivo</option><option>Disattivo</option></select></div>
    `;
    $("#edit-associated-structure").value = associatedStructure;
    if (budget) {
      $("#edit-frequency").value = budget.frequency;
      $("#edit-type").value = budget.type;
      $("#edit-state").value = budget.state;
    }
    $("#edit-form button[type='submit']").textContent = "Salva modifiche";
    $("#edit-modal").classList.add("open");
    $("#edit-modal").setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    $("#edit-modal").classList.remove("open");
    $("#edit-modal").setAttribute("aria-hidden", "true");
    editing = null;
  }

  function copyBudget(budgetId) {
    const sourceIndex = budgets.findIndex((budget) => budget.id === budgetId);
    if (sourceIndex < 0) return;
    const source = budgets[sourceIndex];
    const copied = copyBudgetWithNextVersion(
      budgets,
      source,
      () => crypto.randomUUID(),
    );
    budgets.splice(sourceIndex + 1, 0, copied);
    persist();
    renderBudgets();
    toast(`${source.name} copiato nella versione ${copied.version}`);
  }

  function deleteBudget(budgetId) {
    const budget = budgets.find((item) => item.id === budgetId);
    if (!budget) return;
    if (budgets.length === 1) {
      toast("Deve rimanere almeno un budget");
      return;
    }
    if (
      !window.confirm(
        `Eliminare ${budget.name}, versione ${budget.version}? L’operazione non può essere annullata.`,
      )
    )
      return;
    budgets = budgets.filter((item) => item.id !== budgetId);
    if (currentBudget.id === budgetId) {
      currentBudget = budgets[0];
      currentChild = currentBudget.children[0];
      analysisScope = "budget";
    }
    persist();
    renderBudgets();
    toast(`${budget.name}, versione ${budget.version}, eliminato`);
  }

  function adjustmentRows() {
    const rows = rowsForCurrent();
    return $("#adj-scope").value === "capex"
      ? capexForCurrent().map((c) => ({
          id: c.id,
          label: `${c.project} · ${c.component}`,
        }))
      : rows[$("#adj-nature").value].map((r) => ({
          id: r.id,
          label: `${r.code} · ${r.voice}`,
        }));
  }
  function populateAdjustmentRows(selectedId) {
    const options = adjustmentRows();
    $("#adj-row").innerHTML = options
      .map((o) => `<option value="${o.id}">${escapeHtml(o.label)}</option>`)
      .join("");
    if (selectedId && options.some((o) => o.id === selectedId))
      $("#adj-row").value = selectedId;
    updateAdjustmentPreview();
  }
  function updateAdjustmentPreview() {
    const scope = $("#adj-scope").value;
    const rowId = $("#adj-row").value;
    const month = Number($("#adj-month").value);
    const amount = Number($("#adj-amount").value || 0);
    let current = 0;
    if (scope === "capex") {
      const comp = capexComponents.find((c) => c.id === rowId);
      current = comp ? comp.approved + comp.adjustment : 0;
    } else {
      const row = rowsForCurrent()[$("#adj-nature").value].find(
        (r) => r.id === rowId,
      );
      current = row
        ? row.values[month] + getApprovedAdjustment(row.id, month)
        : 0;
    }
    $("#adj-preview").textContent =
      `Budget attuale ${euro.format(current)} · Variazione ${amount >= 0 ? "+" : ""}${euro.format(amount)} · Nuovo budget ${euro.format(current + amount)}`;
  }
  function renderAdjustments() {
    const visible = adjustments.filter((item) => item.scope !== "planning" || item.budgetId === currentBudget.id);
    $("#adjustment-count").textContent = `(${visible.length})`;
    $("#adjustment-list").innerHTML = adjustmentListHtml(visible);
  }
  function openAdjustments(rowId, scope = "economic") {
    $("#adj-scope").value = scope;
    if (scope === "economic") {
      const rows = rowsForCurrent();
      if (rows.revenue.some((r) => r.id === rowId))
        $("#adj-nature").value = "revenue";
      else $("#adj-nature").value = "cost";
    }
    populateAdjustmentRows(rowId);
    renderAdjustments();
    $("#adjustment-drawer").classList.add("open");
    $("#adjustment-drawer").setAttribute("aria-hidden", "false");
  }
  function closeAdjustments() {
    $("#adjustment-drawer").classList.remove("open");
    $("#adjustment-drawer").setAttribute("aria-hidden", "true");
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }
  function renderDistributionSchedule() {
    const total = Number($("#dist-total").value || 0);
    const duration = Math.max(
      1,
      Math.min(120, Number($("#dist-duration").value || 1)),
    );
    const stepMonths = Number($("#dist-periodicity").value || 1);
    const start = new Date(
      `${$("#dist-start").value || "2027-01-01"}T00:00:00`,
    );
    $("#distribution-rows").innerHTML = distributionRowsHtml(
      total,
      duration,
      stepMonths,
      start,
      formatDate,
    );
    updateDistributionSummary();
  }
  function updateDistributionSummary() {
    const sum = $$(".distribution-amount").reduce(
      (total, input) => total + Number(input.value || 0),
      0,
    );
    $("#distribution-summary").textContent =
      `Importo ripartito: ${new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(sum)} · ${$$(".distribution-amount").length} scadenze`;
  }
  function openRedistribution(rowId) {
    redistributionRowId = rowId;
    const row = planningLevel(rowId);
    if (!row) return;
    $("#redistribution-title").textContent =
      `Ripartisci · ${row.name}`;
    $("#dist-total").value = (currentBudget.type === "Investimento"
      ? planningAllYearsTotal(row)
      : row.months.reduce((sum, value) => sum + Number(value), 0)).toFixed(2);
    $("#dist-total").setCustomValidity("");
    $("#dist-duration").value = 12;
    $("#dist-periodicity").value = "1";
    $("#dist-start").value = `${currentBudget.type === "Investimento" ? monthlyYear : currentBudget.year}-01-01`;
    $("#distribution-scope-note").textContent = currentBudget.type === "Investimento"
      ? "La conferma sostituisce la ripartizione della voce in tutti gli anni. Modificando l'importo complessivo aggiorni anche il budget della voce."
      : "La conferma sostituisce la ripartizione della voce nell'anno del budget. Modificando l'importo complessivo aggiorni anche il budget della voce e del suo livello padre.";
    $("#distribution-scope-note").hidden = false;
    renderDistributionSchedule();
    $("#redistribution-modal").classList.add("open");
    $("#redistribution-modal").setAttribute("aria-hidden", "false");
  }
  function closeRedistribution() {
    $("#redistribution-modal").classList.remove("open");
    $("#redistribution-modal").setAttribute("aria-hidden", "true");
    redistributionRowId = null;
  }
  function applyDistribution() {
    const row = planningLevel(redistributionRowId);
    if (!row) return;
    const rawTotal = $("#dist-total").value;
    const targetTotal = Number(rawTotal);
    if (rawTotal === "" || !Number.isFinite(targetTotal) || targetTotal < 0 || Math.abs(Math.round(targetTotal * 100) - targetTotal * 100) > 1e-7) {
      toast("Inserisci un importo complessivo valido, con al massimo due decimali");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test($("#dist-start").value)) {
      toast("Inserisci una data di inizio valida");
      return;
    }
    const duration = Number($("#dist-duration").value);
    if (!Number.isInteger(duration) || duration < 1 || duration > 120 || $$("#distribution-rows tr").length !== duration) {
      toast("Aggiorna la durata: il numero di scadenze non coincide");
      return;
    }
    const yearValues = {};
    let outsideYear = false;
    let invalidAmount = false;
    $$("#distribution-rows tr").forEach((tr) => {
      const date = tr.querySelector("[data-distribution-date]").dataset.distributionDate;
      const year = Number(date.slice(0, 4));
      const month = Number(date.slice(5, 7)) - 1;
      const rawAmount = tr.querySelector(".distribution-amount").value;
      const amount = Number(rawAmount);
      if (rawAmount === "" || !Number.isFinite(amount) || amount < 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-7) invalidAmount = true;
      if (currentBudget.type !== "Investimento" && year !== currentBudget.year) outsideYear = true;
      if (!yearValues[year]) yearValues[year] = Array(12).fill(0);
      yearValues[year][month] += Math.round(amount * 100);
    });
    const originalCents = Math.round((currentBudget.type === "Investimento"
      ? planningAllYearsTotal(row)
      : row.months.reduce((sum, value) => sum + Number(value), 0)) * 100);
    const distributedCents = Object.values(yearValues).flat().reduce((sum, value) => sum + value, 0);
    const targetCents = Math.round(targetTotal * 100);
    if (invalidAmount || outsideYear || targetCents !== distributedCents) {
      toast(invalidAmount ? "Inserisci importi validi e non negativi" : outsideYear ? `Tutte le scadenze devono essere nel ${currentBudget.year}` : "La somma delle scadenze deve coincidere con l'importo complessivo");
      return;
    }
    if (targetCents !== originalCents && currentBudget.planning.mode !== "single-level" &&
      !currentBudget.planning.level1.some((level) => level.id === row.parentId)) {
      toast("La voce non ha un livello padre valido");
      return;
    }
    row.months = (yearValues[currentBudget.year] || Array(12).fill(0)).map((value) => value / 100);
    if (currentBudget.type === "Investimento") {
      row.yearMonths = Object.fromEntries(Object.entries(yearValues)
        .filter(([year]) => Number(year) !== currentBudget.year)
        .map(([year, values]) => [year, values.map((value) => value / 100)]));
      monthlyYear = Number($("#dist-start").value.slice(0, 4));
    }
    if (targetCents !== originalCents) {
      syncRedistributedBudget(currentBudget.planning, row, originalCents / 100, targetCents / 100);
    }
    persist();
    renderAnalysis();
    closeRedistribution();
    toast("Importo redistribuito e piano mensile aggiornato");
  }

  $("#budget-list").addEventListener("click", (event) => {
    const editBudget = event.target.closest("[data-edit-budget]");
    const copy = event.target.closest("[data-copy-budget]");
    const openBudget = event.target.closest("[data-open-budget]");
    const remove = event.target.closest("[data-delete-budget]");
    if (editBudget) openEdit("budget", editBudget.dataset.editBudget);
    if (copy) copyBudget(copy.dataset.copyBudget);
    if (openBudget) openAnalysis(openBudget.dataset.openBudget);
    if (remove) deleteBudget(remove.dataset.deleteBudget);
  });
  $("#apply-filters").addEventListener("click", () => {
    renderBudgets();
    toast("Filtri applicati");
  });
  $("#budget-search").addEventListener("input", renderBudgets);
  $("#level-search").addEventListener("input", renderAnalysis);
  $("#voice-search").addEventListener("input", renderAnalysis);
  $("#monthly-search").addEventListener("input", renderMonthly);
  $("#monthly-year").addEventListener("change", (event) => {
    monthlyYear = Number(event.target.value);
    renderMonthly();
  });
  $("#toggle-monthly-adjustments").addEventListener("click", () => {
    monthlyAdjustmentsVisible = !monthlyAdjustmentsVisible;
    $("#toggle-monthly-adjustments").setAttribute("aria-expanded", String(monthlyAdjustmentsVisible));
    renderMonthly();
  });
  $("#show-monthly-history").addEventListener("click", () => {
    const panel = $("#monthly-history");
    panel.hidden = !panel.hidden;
    $("#show-monthly-history").setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) renderMonthlyHistory();
  });
  $("#submit-monthly-adjustments").addEventListener("click", () => {
    const result = collectAdjustmentChanges();
    if (result.error) return toast(result.error);
    if (!result.changes.length) return toast("Modifica almeno una cella di rettifica.");
    $("#adjustment-reason-summary").innerHTML =
      `<p>${result.changes.length} ${result.changes.length === 1 ? "mese modificato" : "mesi modificati"} per ${escapeHtml(currentBudget.name)}, anno ${monthlyYear}. La richiesta resterà in approvazione.</p><ul>${result.changes.map(({ level, month, before, after }) => `<li>${escapeHtml(level.code)} · ${escapeHtml(level.name)} · ${months[month]}: ${euroCents.format(before)} → ${euroCents.format(after)}</li>`).join("")}</ul>`;
    $("#adjustment-reason").value = "";
    $("#adjustment-reason-modal").classList.add("open");
    $("#adjustment-reason-modal").setAttribute("aria-hidden", "false");
    $("#adjustment-reason").focus();
  });
  function closeAdjustmentReason() {
    $("#adjustment-reason-modal").classList.remove("open");
    $("#adjustment-reason-modal").setAttribute("aria-hidden", "true");
  }
  $("#close-adjustment-reason").addEventListener("click", closeAdjustmentReason);
  $("#cancel-adjustment-reason").addEventListener("click", closeAdjustmentReason);
  $("#adjustment-reason-modal").addEventListener("click", (event) => {
    if (event.target.id === "adjustment-reason-modal") closeAdjustmentReason();
  });
  $("#adjustment-reason-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const reason = $("#adjustment-reason").value.trim();
    if (!reason) {
      $("#adjustment-reason").setCustomValidity("Scrivi la motivazione della rettifica.");
      $("#adjustment-reason").reportValidity();
      return;
    }
    const result = collectAdjustmentChanges();
    if (result.error || !result.changes.length) return toast(result.error || "Nessuna modifica da inviare.");
    const requestId = `RET-${Date.now()}`;
    const createdAt = new Date().toISOString();
    monthlyHistory.unshift(createMonthlySnapshot(requestId, reason, createdAt, result.changes));
    result.changes.forEach(({ level, year, month, before, after, amount }, index) => {
      adjustments.unshift({
        id: `${requestId}-${index + 1}`,
        requestId,
        budgetId: currentBudget.id,
        scope: "planning",
        nature: "cost",
        rowId: level.id,
        rowLabel: `${level.code} · ${level.name}`,
        year,
        month,
        amount,
        before,
        after,
        reason,
        attachment: "",
        status: "In approvazione",
        createdAt,
      });
      adjustmentDrafts.delete(adjustmentDraftKey(level.id, month, year));
    });
    persist();
    closeAdjustmentReason();
    renderAnalysis();
    $("#monthly-history").hidden = false;
    $("#show-monthly-history").setAttribute("aria-expanded", "true");
    renderMonthlyHistory();
    toast("Rettifica inviata in approvazione e salvata nello storico");
  });
  $("#adjustment-reason").addEventListener("input", (event) => event.target.setCustomValidity(""));
  $("#capex-search").addEventListener("input", renderCapex);
  $("#create-budget").addEventListener("click", () => openEdit("new"));
  $("#back-management").addEventListener("click", () => showPage("management"));
  $("#save-analysis").addEventListener("click", () => {
    const validation = planningValidation(currentBudget.planning);
    if (!validation.valid) {
      if (validation.allocationPercentError) {
        const difference = Math.abs(100 - validation.allocationPercent);
        toast(`Per salvare, le percentuali di Livello 1 devono totalizzare 100%. Da sistemare: ${difference.toFixed(2)} punti.`);
      } else if (validation.level2AllocationErrors.length) {
        toast("Le percentuali sul totale dei figli devono quadrarsi con la quota del rispettivo padre.");
      } else if (validation.level2TotalPercentError) {
        toast(`Le percentuali sul totale del Livello 2 devono totalizzare 100%. Attuale: ${validation.level2TotalPercent.toFixed(2)}%.`);
      } else {
        toast("Correggi le percentuali dei figli e i mesi evidenziati in rosso prima di salvare");
      }
      return;
    }
    persist();
    toast("Pianificazione budget salvata");
  });
  $("#analysis-type").addEventListener("change", (event) => {
    const next = budgets.find((budget) => budget.type === event.target.value);
    if (next) openAnalysis(next.id);
    else {
      event.target.value = currentBudget.type;
      toast("Nessun budget di questo tipo disponibile");
    }
  });
  $("#analysis-budget-field").addEventListener("change", (event) =>
    openAnalysis(event.target.value),
  );
  const toggleSelection = (selection, id) => {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  let planningModalContext = null;
  const planningModal = $("#planning-modal");
  const closePlanningModal = () => {
    planningModal.classList.remove("open");
    planningModal.setAttribute("aria-hidden", "true");
    planningModalContext = null;
  };
  const showPlanningModal = (context, title, fields) => {
    planningModalContext = context;
    $("#planning-modal-title").textContent = title;
    $("#planning-modal-body").innerHTML = fields;
    $("#planning-code")?.addEventListener("input", (event) => event.target.setCustomValidity(""));
    planningModal.classList.add("open");
    planningModal.setAttribute("aria-hidden", "false");
    $("#planning-modal-body").querySelector("input,select")?.focus();
  };
  const openPlanningForm = (kind, id = null) => {
    const planning = currentBudget.planning;
    const isNew = !id;
    const field = (label, name, value, type = "number", attrs = "") => `<div class="field"><label for="planning-${name}">${label}</label><input id="planning-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs}></div>`;
    const select = (label, name, options) => `<div class="field full"><label for="planning-${name}">${label}</label><select id="planning-${name}" name="${name}" required>${options}</select></div>`;
    const options = (items, selected = "") => items.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join("");
    const customFields = () => `<div class="field full" id="planning-custom-fields" hidden>${field("Codice", "code", "", "text", 'maxlength="40"')}${field("Descrizione", "name", "", "text", 'maxlength="120"')}</div>`;
    const chooseCustom = (selectId) => {
      const chooser = $(`#${selectId}`);
      const custom = $("#planning-custom-fields");
      if (!chooser || !custom) return;
      const update = () => {
        const isCustom = chooser.value === "__new__";
        custom.hidden = !isCustom;
        custom.querySelectorAll("input").forEach((input) => { input.required = isCustom; });
      };
      chooser.addEventListener("change", update);
      update();
    };
    const monthlyLevels = planning.mode === "single-level" ? planning.level1 : planning.level2;
    let fields = "";
    if (kind === "l1") {
      const item = id ? planning.level1.find((entry) => entry.id === id) : null;
      const available = planning.catalog.level1.filter((entry) => !planning.level1.some((level) => normalizeCode(level.code) === normalizeCode(entry.code)));
      fields = isNew ? select("Struttura analitica", "catalog-id", `${options(available)}<option value="__new__">Nuova struttura analitica</option>`) + customFields() + field("Budget (€)", "budget", "0", "number", 'min="0" step="0.01" required') : field("Budget (€)", "budget", item.budget || 0, "number", 'min="0" step="0.01" required');
      showPlanningModal({ kind, id, isNew }, isNew ? "Aggiungi Livello 1" : `Modifica ${item.name}`, fields);
      if (isNew) chooseCustom("planning-catalog-id");
    } else if (kind === "l2") {
      const item = id ? planning.level2.find((entry) => entry.id === id) : null;
      const available = planning.catalog.level2.filter((entry) => !planning.level2.some((level) => normalizeCode(level.code) === normalizeCode(entry.code)) && planning.level1.some((parent) => normalizeCode(parent.code) === normalizeCode(entry.parentCode)));
      const parents = planning.level1;
      const selectedCatalogItem = available[0];
      const catalogParent = parents.find((parent) => normalizeCode(parent.code) === normalizeCode(selectedCatalogItem?.parentCode));
      const parentId = item?.parentId || catalogParent?.id || (selectedLevel1Ids.size === 1 ? [...selectedLevel1Ids][0] : "");
      const selectedParent = parents.find((parent) => parent.id === parentId);
      const parentLabel = selectedParent ? `${selectedParent.code} · ${selectedParent.name}` : "Seleziona un elemento";
      fields = (isNew ? select("Elemento struttura", "catalog-id", `${options(available)}<option value="__new__">Nuovo elemento struttura</option>`) + customFields() : `<div class="field full"><label>Elemento</label><div class="readonly-value">${escapeHtml(item.code)} · ${escapeHtml(item.name)}</div></div>`) + `<div class="field full" id="planning-parent-field"><label>Appartiene a</label><div class="readonly-value" id="planning-parent-label">${escapeHtml(parentLabel)}</div><input type="hidden" name="parent-id" id="planning-parent-id" value="${escapeHtml(parentId)}"></div>` + (isNew ? `<div class="field full" id="planning-custom-parent-field" hidden><label for="planning-custom-parent-id">Livello 1</label><select id="planning-custom-parent-id" name="custom-parent-id">${options(parents, parentId)}</select></div>` : "");
      showPlanningModal({ kind, id, isNew }, isNew ? "Aggiungi Livello 2" : `Modifica ${item.name}`, fields);
      const catalogSelect = $("#planning-catalog-id");
      catalogSelect?.addEventListener("change", () => {
        const selectedItem = available.find((entry) => entry.id === catalogSelect.value);
        const parent = planning.level1.find((entry) => normalizeCode(entry.code) === normalizeCode(selectedItem?.parentCode));
        $("#planning-parent-id").value = parent?.id || "";
        $("#planning-parent-label").textContent = parent ? `${parent.code} · ${parent.name}` : "Struttura padre non presente nel budget";
        const custom = catalogSelect.value === "__new__";
        $("#planning-parent-field").hidden = custom;
        $("#planning-custom-parent-field").hidden = !custom;
      });
      if (isNew) chooseCustom("planning-catalog-id");
      if (catalogSelect?.value === "__new__") { $("#planning-parent-field").hidden = true; $("#planning-custom-parent-field").hidden = false; }
    } else {
      const item = monthlyLevels.find((entry) => entry.id === id);
      const choices = monthlyLevels.filter((entry) => entry.monthlyActive === false);
      const selectedMonths = item && planning.mode === "single-level"
        ? planningYearMonths(item, monthlyYear, currentBudget.year)
        : item?.months;
      const monthFields = months.map((name, index) => field(name, `month-${index}`, selectedMonths?.[index] || 0, "number", 'min="0" step="0.01"')).join("");
      fields = (isNew ? select("Elemento da pianificare", "level-id", `${options(choices)}<option value="__new__">Nuova voce mensile</option>`) + customFields() + (planning.mode === "two-level" ? select("Livello 1 della nuova voce", "custom-parent-id", options(planning.level1)) : "") : `<div class="field full"><label>Elemento</label><div class="readonly-value">${escapeHtml(item.code)} · ${escapeHtml(item.name)}</div></div>`) + `<div class="planning-month-fields">${monthFields}</div>`;
      showPlanningModal({ kind, id, isNew }, isNew ? "Aggiungi pianificazione mensile" : `Modifica ${item.name}${planning.mode === "single-level" ? ` · ${monthlyYear}` : ""}`, fields);
      if (isNew) {
        chooseCustom("planning-level-id");
        const parentField = $("#planning-custom-parent-id")?.closest(".field");
        const updateParent = () => {
          if (!parentField) return;
          parentField.hidden = $("#planning-level-id").value !== "__new__";
          $("#planning-custom-parent-id").required = !parentField.hidden;
        };
        $("#planning-level-id").addEventListener("change", updateParent);
        updateParent();
      }
    }
  };
  $("#add-l1").addEventListener("click", () => openPlanningForm("l1"));
  $("#add-l2").addEventListener("click", () => openPlanningForm("l2"));
  const splitPercentage = (total, count) => {
    const cents = Math.max(0, Math.round(Number(total || 0) * 100));
    const base = Math.floor(cents / count);
    const remainder = cents % count;
    return Array.from(
      { length: count },
      (_, index) => (base + (index < remainder ? 1 : 0)) / 100,
    );
  };
  $("#distribute-l1").addEventListener("click", () => {
    const planning = currentBudget.planning;
    const levels = planning.level1;
    if (!levels.length) return;
    const percentages = splitPercentage(100, levels.length);
    const totalCents = Math.round(planningBaseTotal(planning) * 100);
    let allocatedCents = 0;
    levels.forEach((level, index) => {
      level.totalPercent = percentages[index];
      const budgetCents = index === levels.length - 1
        ? totalCents - allocatedCents
        : Math.round(totalCents * percentages[index] / 100);
      level.budget = budgetCents / 100;
      allocatedCents += budgetCents;
    });
    resizeDescendantMonths(planning);
    renderAnalysis();
    persist();
    toast("Percentuali Livello 1 ripartite equamente sul 100%");
  });
  $("#distribute-l2").addEventListener("click", () => {
    const planning = currentBudget.planning;
    let distributed = false;
    planning.level1.forEach((parent) => {
      const children = planning.level2.filter(
        (level) => level.parentId === parent.id,
      );
      if (!children.length) return;
      distributed = true;
      const parentPercent = Number(
        parent.totalPercent ?? (
          planningBaseTotal(planning) > 0
            ? Number(parent.budget || 0) / planningBaseTotal(planning) * 100
            : 0
        ),
      );
      const percentages = splitPercentage(parentPercent, children.length);
      children.forEach((level, index) => {
        level.totalPercent = percentages[index];
      });
    });
    if (!distributed) {
      toast("Aggiungi prima almeno un elemento di Livello 2");
      return;
    }
    resizeDescendantMonths(planning);
    renderAnalysis();
    persist();
    toast("Percentuali Livello 2 ripartite equamente per ciascun padre");
  });
  $("#add-monthly").addEventListener("click", () => openPlanningForm("monthly"));
  $("#close-planning-modal").addEventListener("click", closePlanningModal);
  $("#cancel-planning-modal").addEventListener("click", closePlanningModal);
  planningModal.addEventListener("click", (event) => { if (event.target === planningModal) closePlanningModal(); });
  $("#planning-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const context = planningModalContext;
    if (!context) return;
    const data = new FormData(event.currentTarget);
    const planning = currentBudget.planning;
    const customEntry = (levels, catalog) => {
      const code = String(data.get("code") || "").trim();
      const name = String(data.get("name") || "").trim();
      if (!code || !name) { toast("Inserisci codice e descrizione"); return null; }
      if ([...levels, ...catalog].some((level) => normalizeCode(level.code) === normalizeCode(code))) {
        $("#planning-code").setCustomValidity("Il codice è già presente in questa tabella");
        $("#planning-code").reportValidity();
        return null;
      }
      return { id: `custom-${crypto.randomUUID()}`, code, name };
    };
    if (context.kind === "l1") {
      if (context.isNew) {
        const custom = data.get("catalog-id") === "__new__";
        const item = custom ? customEntry(planning.level1, planning.catalog.level1) : planning.catalog.level1.find((entry) => entry.id === data.get("catalog-id"));
        if (!item) return;
        const amount = Number(data.get("budget") || 0);
        if (custom) planning.catalog.level1.push(clone(item));
        const added = { ...clone(item), id: `l1-${currentBudget.id}-${item.id}`, budget: amount, totalPercent: planningBaseTotal(planning) > 0 ? amount / planningBaseTotal(planning) * 100 : 0, months: Array(12).fill(0), monthlyActive: false };
        planning.level1.push(added); selectedLevel1Ids = new Set([added.id]); selectedLevel2Ids = new Set(); selectedMonthlyIds = new Set();
      } else {
        const level = planning.level1.find((entry) => entry.id === context.id);
        if (level) level.budget = Math.max(0, Number(data.get("budget") || 0));
      }
      if (planning.mode === "single-level") {
        syncSingleLevelBudgetPercentages(planning);
        resizeDescendantMonths(planning);
      }
    } else if (context.kind === "l2") {
      if (context.isNew) {
        const custom = data.get("catalog-id") === "__new__";
        const item = custom ? customEntry(planning.level2, planning.catalog.level2) : planning.catalog.level2.find((entry) => entry.id === data.get("catalog-id"));
        const parent = planning.level1.find((entry) => entry.id === data.get(custom ? "custom-parent-id" : "parent-id"));
        if (!item || !parent || (!custom && normalizeCode(parent.code) !== normalizeCode(item.parentCode))) { toast("Seleziona un Livello 1 valido"); return; }
        if (custom) planning.catalog.level2.push({ ...clone(item), parentId: parent.id, parentCode: parent.code });
        const added = { ...clone(item), id: `l2-${currentBudget.id}-${item.id}`, parentId: parent.id, parentCode: parent.code, totalPercent: 0, months: Array(12).fill(0), monthlyActive: false };
        planning.level2.push(added); selectedLevel1Ids = new Set([parent.id]); selectedLevel2Ids = new Set([added.id]); selectedMonthlyIds = new Set();
      } else {
        const level = planning.level2.find((entry) => entry.id === context.id);
        const parent = planning.level1.find((entry) => entry.id === data.get("parent-id"));
        if (level && parent && normalizeCode(parent.code) === normalizeCode(level.parentCode)) { level.parentId = parent.id; level.parentCode = parent.code; }
      }
    } else {
      const levels = planning.mode === "single-level" ? planning.level1 : planning.level2;
      const custom = context.isNew && data.get("level-id") === "__new__";
      let level = levels.find((entry) => entry.id === (context.isNew ? data.get("level-id") : context.id));
      const previousAmount = level
        ? level.monthlyActive === false
          ? planning.mode === "single-level" ? Number(level.budget || 0) : level2Budget(planning, level)
          : planning.mode === "single-level" ? planningAllYearsTotal(level) : monthlyTotal(level.months)
        : 0;
      if (custom) {
        const item = customEntry(levels, planning.catalog[planning.mode === "single-level" ? "level1" : "level2"]);
        if (!item) return;
        const parent = planning.mode === "two-level" ? planning.level1.find((entry) => entry.id === data.get("custom-parent-id")) : null;
        if (planning.mode === "two-level" && !parent) { toast("Seleziona un Livello 1 valido"); return; }
        level = { ...item, ...(parent ? { parentId: parent.id, parentCode: parent.code } : {}), budget: 0, totalPercent: 0, months: Array(12).fill(0), monthlyActive: true };
        levels.push(level);
        planning.catalog[planning.mode === "single-level" ? "level1" : "level2"].push({ ...item, ...(parent ? { parentId: parent.id, parentCode: parent.code } : {}) });
      }
      if (level) {
        const values = months.map((_, index) => Number(data.get(`month-${index}`) || 0));
        if (planning.mode === "two-level" && !planning.level1.some((item) => item.id === level.parentId)) {
          toast("La voce non ha un livello padre valido");
          return;
        }
        level.monthlyActive = true;
        if (planning.mode === "single-level" && monthlyYear !== currentBudget.year) {
          level.yearMonths ||= {};
          level.yearMonths[monthlyYear] = values;
        } else level.months = values;
        const nextAmount = planning.mode === "single-level" ? planningAllYearsTotal(level) : monthlyTotal(level.months);
        if (Math.round(nextAmount * 100) !== Math.round(previousAmount * 100)) {
          syncRedistributedBudget(planning, level, previousAmount, nextAmount);
        }
        selectedMonthlyIds = new Set([level.id]);
        if (planning.mode === "single-level") selectedLevel1Ids = new Set([level.id]);
        else {
          selectedLevel2Ids = new Set([level.id]);
          const parent = planning.level1.find((entry) => entry.id === level.parentId);
          if (parent) selectedLevel1Ids = new Set([parent.id]);
        }
      }
    }
    closePlanningModal(); renderAnalysis(); persist();
  });
  [$("#level-table"), $("#voice-table"), $("#monthly-table")].forEach((table) => table.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-planning-edit]");
    if (editButton) { event.stopPropagation(); openPlanningForm(editButton.dataset.planningEdit, editButton.dataset.planningId); return; }
    const deleteButton = event.target.closest("[data-planning-delete]");
    if (deleteButton) {
      event.stopPropagation();
      const kind = deleteButton.dataset.planningDelete; const id = deleteButton.dataset.planningId; const planning = currentBudget.planning;
      if (kind === "l1" && planning.level2.some((level) => level.parentId === id)) { toast("Elimina prima gli elementi di Livello 2 collegati"); return; }
      if (!window.confirm("Vuoi eliminare questo elemento dal budget?")) return;
      if (kind === "l1") {
        planning.level1 = planning.level1.filter((level) => level.id !== id);
        if (planning.mode === "single-level") syncSingleLevelBudgetPercentages(planning);
      }
      if (kind === "l2") planning.level2 = planning.level2.filter((level) => level.id !== id);
      if (kind === "monthly") { const levels = planning.mode === "single-level" ? planning.level1 : planning.level2; const level = levels.find((entry) => entry.id === id); if (level) { level.monthlyActive = false; level.months = Array(12).fill(0); if (planning.mode === "single-level") level.yearMonths = {}; } }
      selectedLevel1Ids.delete(id); selectedLevel2Ids.delete(id); selectedMonthlyIds.delete(id); renderAnalysis(); persist();
    }
  }));
  const updateLevel1Budget = (event) => {
    const input = event.target.closest("[data-l1-budget]");
    if (!input) return;
    const level = currentBudget.planning.level1.find(
      (item) => item.id === input.dataset.l1Budget,
    );
    if (!level) return;
    level.budget = Math.max(0, Number(input.value || 0));
    if (currentBudget.planning.mode === "single-level") {
      syncSingleLevelBudgetPercentages(currentBudget.planning);
      return;
    }
    const baseTotal = planningBaseTotal(currentBudget.planning);
    level.totalPercent = baseTotal > 0 ? level.budget / baseTotal * 100 : 0;
  };
  const resizeMonthlyDistribution = (level, targetAmount) => {
    if (level.monthlyActive === false) return;
    if (currentBudget.type === "Investimento" && Object.keys(level.yearMonths || {}).length) {
      const years = Object.keys(level.yearMonths).sort((a, b) => Number(a) - Number(b));
      const values = [...level.months, ...years.flatMap((year) => level.yearMonths[year])];
      const resized = scaleMonthlyValues(values, Math.round(Math.max(0, Number(targetAmount || 0)) * 100));
      level.months = resized.slice(0, 12);
      years.forEach((year, index) => { level.yearMonths[year] = resized.slice((index + 1) * 12, (index + 2) * 12); });
      return;
    }
    const current = Array.from({ length: 12 }, (_, index) => Number(level.months?.[index] || 0));
    const currentTotal = current.reduce((sum, value) => sum + value, 0);
    const targetCents = Math.round(Math.max(0, Number(targetAmount || 0)) * 100);
    let allocatedCents = 0;
    level.months = current.map((value, index) => {
      const cents = index === current.length - 1
        ? targetCents - allocatedCents
        : currentTotal > 0
          ? Math.round(targetCents * value / currentTotal)
          : Math.floor(targetCents / current.length);
      allocatedCents += cents;
      return cents / 100;
    });
  };
  const resizeDescendantMonths = (planning) => {
    if (planning.mode === "single-level") {
      planning.level1.forEach((level) => resizeMonthlyDistribution(level, level.budget));
      return;
    }
    planning.level2.forEach((level) => {
      resizeMonthlyDistribution(
        level,
        planningBaseTotal(planning) * Number(level.totalPercent || 0) / 100,
      );
    });
  };
  const updateLevel1Percent = (event) => {
    const input = event.target.closest("[data-l1-percent]");
    if (!input) return;
    const planning = currentBudget.planning;
    const selected = planning.level1.find((item) => item.id === input.dataset.l1Percent);
    if (!selected) return;
    const baseTotal = planningBaseTotal(planning);
    if (baseTotal <= 0) { toast("Inserisci prima un budget complessivo di riferimento"); return; }
    const enteredPercent = Number(input.value || 0);
    const percent = Math.min(100, Math.max(0, enteredPercent));
    if (enteredPercent > 100 || enteredPercent < 0) {
      toast("La percentuale deve essere compresa tra 0% e 100%. Ho applicato il limite massimo.");
    }
    input.value = percent.toFixed(2);
    selected.totalPercent = percent;
    selected.budget = Math.round((baseTotal * percent / 100) * 100) / 100;
  };
  $("#level-table").addEventListener("change", (event) => {
    if (event.target.closest("[data-l1-budget]")) updateLevel1Budget(event);
    if (event.target.closest("[data-l1-percent]")) updateLevel1Percent(event);
    resizeDescendantMonths(currentBudget.planning);
    renderAnalysis();
    persist();
  });
  $("#level-table").addEventListener("click", (event) => {
    if (event.target.closest("input,button")) return;
    const row = event.target.closest("[data-select-l1]");
    if (!row) return;
    selectedLevel1Ids = toggleSelection(
      selectedLevel1Ids,
      row.dataset.selectL1,
    );
    selectedLevel2Ids = new Set();
    selectedMonthlyIds =
      currentBudget.planning.mode === "single-level"
        ? new Set(selectedLevel1Ids)
        : new Set();
    editingLevel1Ids = new Set();
    editingLevel2Ids = new Set();
    editingMonthlyIds = new Set();
    renderAnalysis();
  });
  const updateLevel2TotalPercent = (event) => {
    const input = event.target.closest("[data-l2-total-percent]");
    if (!input) return;
    const planning = currentBudget.planning;
    const level = planning.level2.find((item) => item.id === input.dataset.l2TotalPercent);
    if (!level) return;
    const entered = Number(input.value || 0);
    const percent = Math.min(100, Math.max(0, entered));
    if (entered > 100 || entered < 0) toast("La percentuale deve essere compresa tra 0% e 100%.");
    input.value = percent.toFixed(2);
    level.totalPercent = percent;
  };
  $("#voice-table").addEventListener("change", (event) => {
    if (event.target.closest("[data-l2-total-percent]")) updateLevel2TotalPercent(event);
    resizeDescendantMonths(currentBudget.planning);
    renderAnalysis();
    persist();
  });
  $("#voice-table").addEventListener("click", (event) => {
    if (event.target.closest("input,button")) return;
    const row = event.target.closest("[data-select-l2]");
    if (!row) return;
    selectedLevel2Ids = toggleSelection(
      selectedLevel2Ids,
      row.dataset.selectL2,
    );
    selectedMonthlyIds = new Set(selectedLevel2Ids);
    editingLevel2Ids = new Set();
    editingMonthlyIds = new Set();
    renderAnalysis();
  });

  $$("[data-nature-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      currentNature = button.dataset.natureTab;
      renderMonthly();
    }),
  );
  $("#monthly-table").addEventListener("click", (event) => {
    if (event.target.closest("input")) return;
    const row = event.target.closest("[data-select-monthly]");
    const distribution = event.target.closest("[data-distribute-row]");
    if (row && !event.target.closest("button")) {
      selectedMonthlyIds = toggleSelection(
        selectedMonthlyIds,
        row.dataset.selectMonthly,
      );
      editingMonthlyIds = new Set();
      renderAnalysis();
    }
    if (distribution) openRedistribution(distribution.dataset.distributeRow);
  });
  const updateMonthlyValue = (event) => {
    const input = event.target.closest("[data-plan-month]");
    if (!input) return;
    const planning = currentBudget.planning;
    const levels =
      planning.mode === "single-level" ? planning.level1 : planning.level2;
    const level = levels.find((item) => item.id === input.dataset.planLevel);
    if (!level) return false;
    const amount = Number(input.value || 0);
    if (!setPlanningMonthAmount(planning, level, monthlyYear, Number(input.dataset.planMonth), amount)) {
      toast("Inserisci un importo mensile valido, con al massimo due decimali");
      return false;
    }
    return true;
  };
  $("#monthly-table").addEventListener("input", (event) => {
    const input = event.target.closest("[data-adjust-month]");
    if (!input) return;
    const level = planningLevel(input.dataset.adjustLevel);
    if (!level) return;
    const month = Number(input.dataset.adjustMonth);
    const amount = parseItalianAmount(input.value);
    const approved = planningAdjustment(level.id, month).approved;
    const key = adjustmentDraftKey(level.id, month);
    if (amount != null && Math.round(amount * 100) === Math.round(approved * 100)) adjustmentDrafts.delete(key);
    else adjustmentDrafts.set(key, { budgetId: currentBudget.id, year: monthlyYear, levelId: level.id, month, raw: input.value });
    updateAdjustmentSubmitButton();
    if (amount == null) return;
    input.closest("td").querySelector("small").textContent =
      `Budget ${euroCents.format(Number(currentBudget.type === "Investimento" ? planningYearMonths(level, monthlyYear, currentBudget.year)[month] : level.months[month]) + amount)}`;
    const row = input.closest("tr");
    const total = [...row.querySelectorAll("[data-adjust-month]")].reduce((sum, cell) => sum + (parseItalianAmount(cell.value) ?? 0), 0);
    const base = (currentBudget.type === "Investimento" ? planningYearMonths(level, monthlyYear, currentBudget.year) : level.months).reduce((sum, value) => sum + Number(value), 0);
    row.querySelector("[data-monthly-adjustment]").textContent = euroCents.format(total);
    row.querySelector("[data-monthly-updated]").textContent = euroCents.format(base + total);
    const foot = $("#monthly-foot tr");
    const monthTotal = [...$("#monthly-table").querySelectorAll(`[data-adjust-month="${month}"]`)].reduce((sum, cell) => sum + (parseItalianAmount(cell.value) ?? 0), 0);
    foot.children[2 + month * 2].textContent = euroCents.format(monthTotal);
    const allAdjustments = [...$("#monthly-table").querySelectorAll("[data-adjust-month]")].reduce((sum, cell) => sum + (parseItalianAmount(cell.value) ?? 0), 0);
    const visibleBase = [...$("#monthly-table").querySelectorAll("[data-select-monthly]")].reduce((sum, tr) => sum + (currentBudget.type === "Investimento" ? planningYearMonths(planningLevel(tr.dataset.selectMonthly), monthlyYear, currentBudget.year) : planningLevel(tr.dataset.selectMonthly).months).reduce((total, value) => total + Number(value), 0), 0);
    foot.children[26].textContent = euroCents.format(allAdjustments);
    foot.children[27].textContent = euroCents.format(visibleBase + allAdjustments);
  });
  $("#monthly-table").addEventListener("change", (event) => {
    const adjustmentInput = event.target.closest("[data-adjust-month]");
    if (adjustmentInput) {
      const parsed = parseItalianAmount(adjustmentInput.value);
      if (parsed != null) {
        adjustmentInput.value = decimalInput.format(parsed);
        const key = adjustmentDraftKey(adjustmentInput.dataset.adjustLevel, Number(adjustmentInput.dataset.adjustMonth));
        if (adjustmentDrafts.has(key)) adjustmentDrafts.get(key).raw = adjustmentInput.value;
      }
      return;
    }
    if (!event.target.closest("[data-plan-month]")) return;
    if (!updateMonthlyValue(event)) {
      renderMonthly();
      return;
    }
    renderAnalysis();
    persist();
  });
  $("#open-adjustments").addEventListener("click", () => openAdjustments());
  $("#capex-adjustment").addEventListener("click", () =>
    openAdjustments(capexForCurrent()[0]?.id, "capex"),
  );
  $("#close-adjustments").addEventListener("click", closeAdjustments);
  $("#adjustment-drawer").addEventListener("click", (event) => {
    if (event.target.id === "adjustment-drawer") closeAdjustments();
  });
  $("#adj-scope").addEventListener("change", () => populateAdjustmentRows());
  $("#adj-nature").addEventListener("change", () => populateAdjustmentRows());
  $("#adj-row").addEventListener("change", updateAdjustmentPreview);
  $("#adj-month").addEventListener("change", updateAdjustmentPreview);
  $("#adj-amount").addEventListener("input", updateAdjustmentPreview);
  $("#clear-adjustment").addEventListener("click", () => {
    $("#adj-amount").value = 0;
    $("#adj-reason").value = "";
    $("#adj-attachment").value = "";
    updateAdjustmentPreview();
  });
  $("#adjustment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const option = $("#adj-row").selectedOptions[0];
    adjustments.unshift({
      id: `RET-${String(50 + adjustments.length).padStart(4, "0")}`,
      scope: $("#adj-scope").value,
      nature: $("#adj-nature").value,
      rowId: $("#adj-row").value,
      rowLabel: option?.textContent || "",
      month: Number($("#adj-month").value),
      amount: Number($("#adj-amount").value || 0),
      reason: $("#adj-reason").value,
      attachment: $("#adj-attachment").value,
      status: "Bozza",
    });
    persist();
    renderAdjustments();
    renderAnalysis();
    toast("Rettifica salvata in bozza");
  });
  $("#adjustment-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-send-adjustment]");
    if (!button) return;
    const item = adjustments.find(
      (a) => a.id === button.dataset.sendAdjustment,
    );
    if (item) item.status = "In approvazione";
    persist();
    renderAdjustments();
    toast("Rettifica inviata ad approvazione");
  });

  $("#edit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (editing.type === "new") {
      const id = `bdg${Date.now()}`;
      budgets.push({
        id,
        year: Number(data.year),
        name: data.name.toUpperCase(),
        version: Number(data.version),
        frequency: data.frequency,
        revision: Number(data.revision),
        associatedStructure: data.associatedStructure.trim(),
        type: data.budgetType,
        state: data.state,
        children: [
          {
            id: `${id}01`,
            code: data.budgetType === "Investimento" ? "CAP-NEW-01" : "NEW-001",
            name: "Nuovo livello da completare",
            state: "Bozza",
            ...(data.budgetType === "Investimento"
              ? { fundingSource: "Da definire" }
              : {}),
          },
        ],
      });
    } else {
      const budget = budgets.find((b) => b.id === editing.budgetId);
      Object.assign(budget, {
        year: Number(data.year),
        name: data.name.toUpperCase(),
        version: Number(data.version),
        revision: Number(data.revision),
        frequency: data.frequency,
        associatedStructure: data.associatedStructure.trim(),
        type: data.budgetType,
        state: data.state,
      });
    }
    ensureFundingSources();
    persist();
    renderBudgets();
    closeModal();
    toast("Modifiche salvate");
  });
  $("#close-modal").addEventListener("click", closeModal);
  $("#cancel-modal").addEventListener("click", closeModal);
  $("#edit-modal").addEventListener("click", (event) => {
    if (event.target.id === "edit-modal") closeModal();
  });
  ["dist-total", "dist-duration", "dist-periodicity", "dist-start"].forEach(
    (id) =>
      $(`#${id}`).addEventListener("input", () => {
        $("#dist-total").setCustomValidity("");
        renderDistributionSchedule();
      }),
  );
  $("#distribution-rows").addEventListener("input", (event) => {
    if (event.target.classList.contains("distribution-amount"))
      updateDistributionSummary();
  });
  $("#confirm-distribution").addEventListener("click", applyDistribution);
  $("#close-redistribution").addEventListener("click", closeRedistribution);
  $("#redistribution-modal").addEventListener("click", (event) => {
    if (event.target.id === "redistribution-modal") closeRedistribution();
  });

  $("#new-voice").addEventListener("click", openVoiceModal);
  $("#voice-form").addEventListener("submit", addBudgetVoice);
  $("#voice-nature").addEventListener("change", updateVoiceAccounts);
  ["voice-total", "voice-frequency", "voice-start-month"].forEach((id) =>
    $(`#${id}`).addEventListener("input", updateVoicePreview),
  );
  $("#voice-description").addEventListener("input", () =>
    $("#voice-description").setCustomValidity(""),
  );
  $("#voice-account").addEventListener("input", () =>
    $("#voice-account").setCustomValidity(""),
  );
  $("#close-voice-modal").addEventListener("click", closeVoiceModal);
  $("#cancel-voice-modal").addEventListener("click", closeVoiceModal);
  $("#voice-modal").addEventListener("click", (event) => {
    if (event.target.id === "voice-modal") closeVoiceModal();
  });
  $("#new-component").addEventListener("click", () => openComponentModal());
  $("#capex-year").addEventListener("change", (event) => {
    capexYear = Number(event.target.value);
    renderCapex();
  });
  $("#capex-table").addEventListener("click", (event) => {
    const payment = event.target.closest("[data-edit-payment]");
    if (payment) {
      const [componentId, month] = payment.dataset.editPayment.split("|");
      openComponentModal(componentId, capexYear);
      $(`#payment-${month}`)?.focus();
      return;
    }
    const button = event.target.closest("[data-edit-component]");
    if (button) openComponentModal(button.dataset.editComponent);
  });
  $("#component-form").addEventListener("submit", saveInvestmentComponent);
  $("#component-description").addEventListener("input", () =>
    $("#component-description").setCustomValidity(""),
  );
  $("#component-account").addEventListener("input", () =>
    $("#component-account").setCustomValidity(""),
  );
  $("#component-purchase-date").addEventListener("input", (event) =>
    event.target.setCustomValidity(""),
  );
  [
    "component-amount",
    "component-first-due",
    "component-installments",
    "component-interval",
    "component-interest",
  ].forEach((id) =>
    $(`#${id}`).addEventListener("input", (event) => {
      if (id === "component-first-due") event.target.setCustomValidity("");
      if ($("#component-payment-mode").value !== "manuale") planDirty = true;
      updateComponentPreview();
    }),
  );
  ["component-life", "component-service-date"].forEach((id) =>
    $(`#${id}`).addEventListener("input", updateComponentPreview),
  );
  $("#component-payment-mode").addEventListener("change", () => {
    draftSchedule = [];
    planDirty = $("#component-payment-mode").value !== "manuale";
    updateComponentPlanMode();
  });
  $("#component-generate").addEventListener("click", generateComponentPlan);
  $("#component-plan-year").addEventListener("change", (event) =>
    renderComponentPaymentFields(Number(event.target.value)),
  );
  $("#component-payment-fields").addEventListener("input", (event) => {
    if (
      event.target.matches("[data-payment-month]") &&
      $("#component-payment-mode").value === "manuale"
    ) {
      draftManualPayments[Number(event.target.dataset.paymentMonth)] = Number(
        event.target.value || 0,
      );
      updateComponentPreview();
    }
  });
  $("#close-component-modal").addEventListener("click", closeComponentModal);
  $("#cancel-component-modal").addEventListener("click", closeComponentModal);
  $("#component-modal").addEventListener("click", (event) => {
    if (event.target.id === "component-modal") closeComponentModal();
  });
  $("#submit-capex").addEventListener("click", () => {
    capexForCurrent().forEach((c) => {
      if (c.state === "Pianificato") c.state = "In approvazione";
    });
    persist();
    renderCapex();
    toast("Commessa CAPEX inviata ad approvazione");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePlanningModal();
      closeModal();
      closeVoiceModal();
      closeComponentModal();
      closeAdjustments();
      closeAdjustmentReason();
      closeRedistribution();
    }
  });
  renderBudgets();
  hydrateFromServer();
})();
