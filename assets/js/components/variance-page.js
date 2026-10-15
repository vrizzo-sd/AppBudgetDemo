import { escapeHtml } from "../core/formatters.js";
import { buildVarianceTree } from "../core/variance-analysis.js";
import { varianceRowsHtml } from "./variance-table.js";
import { varianceChartData } from "../core/variance-chart-data.js";
import { varianceChartsHtml } from "./variance-charts.js";

export function createVariancePage(getBudgets, showPage) {
  const $ = (id) => document.getElementById(`variance-${id}`);
  const approved = () => getBudgets().filter((budget) => budget.workflowState === "Approvato" && budget.revisions?.length);
  const family = (budget) => JSON.stringify([budget.name, budget.year, budget.associatedStructure, budget.type]);
  const options = (items) => items.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  let selected = null, root = null, expanded = new Set();
  let actuals = [], loading = false, loadError = "", requestNumber = 0;
  let chartRoot = null;

  function renderRows() {
    $("rows").innerHTML = root ? varianceRowsHtml(root, expanded) : '<tr><td colspan="7" class="center muted">Nessun confronto disponibile.</td></tr>';
    $("expand").disabled = $("collapse").disabled = !root;
    if (chartRoot !== root) {
      $("charts").hidden = !root;
      $("charts").innerHTML = root ? varianceChartsHtml(varianceChartData(selected, Number($("revision").value), $("from").value, $("to").value, actuals, root)) : "";
      chartRoot = root;
    }
  }

  function render() {
    root = null;
    $("message").textContent = "";
    $("context").textContent = "";
    if (!selected) {
      $("message").textContent = "Non ci sono versioni approvate. Approva una versione nella Redazione budget per consultarne gli scostamenti.";
      renderRows();
      return;
    }
    if (loading || loadError) {
      $("message").textContent = loading ? "Caricamento consuntivi dal database…" : loadError;
      renderRows();
      return;
    }
    try {
      root = buildVarianceTree(selected, Number($("revision").value), $("from").value, $("to").value, actuals);
      const monthLabel = (value) => {
        const [year, month] = value.split("-").map(Number);
        return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
      };
      $("context").textContent = `${selected.name} ${selected.year} · Versione ${selected.version} · Revisione ${$("revision").value}${selected.isOfficial ? " · Versione ufficiale" : " · Versione precedente"} · ${monthLabel($("from").value)} – ${monthLabel($("to").value)}`;
      if (root.actual === null) $("message").textContent = "Consuntivo non disponibile per alcune righe o mesi selezionati: i relativi scostamenti e i totali incompleti sono indicati con —.";
    } catch (error) {
      $("message").textContent = error.message;
    }
    renderRows();
  }

  function expandAll() {
    expanded = new Set();
    const visit = (row) => {
      if (row.children.length) expanded.add(row.id);
      row.children.forEach(visit);
    };
    if (root) visit(root);
    renderRows();
  }

  async function selectVersion(budget, resetPeriod) {
    selected = budget;
    $("version").value = budget.id;
    $("revision").innerHTML = options(budget.revisions.map((revision) => [revision.number,
      `R${revision.number}${revision.number === 0 ? " · Iniziale" : ""}`]));
    $("revision").value = budget.revisions.at(-1).number;
    for (const name of ["from", "to"]) {
      $(name).min = `${budget.year}-01`;
      $(name).max = `${budget.type === "Investimento" ? 2100 : budget.year}-12`;
    }
    if (resetPeriod) {
      $("from").value = `${budget.year}-01`;
      $("to").value = `${budget.year}-12`;
    }
    actuals = [];
    loading = true;
    loadError = "";
    const currentRequest = ++requestNumber;
    render();
    try {
      const response = await fetch(`/api/actuals?budgetId=${encodeURIComponent(budget.id)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Lettura consuntivi non riuscita.");
      const result = await response.json();
      if (!Array.isArray(result.actuals)) throw new Error("Risposta consuntivi non valida.");
      if (currentRequest === requestNumber) actuals = result.actuals;
    } catch {
      if (currentRequest === requestNumber) loadError = "Impossibile leggere i consuntivi dal database. Avvia o riavvia start.bat e riapri l’analisi.";
    } finally {
      if (currentRequest === requestNumber) {
        loading = false;
        render();
        expandAll();
      }
    }
  }

  function selectFamily(budget, resetPeriod = true) {
    const versions = approved().filter((item) => family(item) === family(budget)).sort((a, b) => a.version - b.version);
    $("budget").value = family(budget);
    $("version").innerHTML = options(versions.map((item) => [item.id, `V${item.version}${item.isOfficial ? " · Ufficiale" : ""}`]));
    selectVersion(budget, resetPeriod);
  }

  function open(budgetId) {
    const budgets = approved(), families = new Map();
    budgets.forEach((budget) => families.set(family(budget), budget));
    $("budget").innerHTML = options([...families].map(([key, budget]) => [key,
      `${budget.name} · ${budget.year} · ${budget.type}${budget.associatedStructure ? ` · ${budget.associatedStructure}` : ""}`]));
    ["budget", "version", "revision", "from", "to", "apply"].forEach((id) => { $(id).disabled = !budgets.length; });
    if (budgets.length) {
      selectFamily(budgets.find((budget) => budget.id === budgetId) || budgets.find((budget) => budget.isOfficial) || budgets[0]);
    } else {
      requestNumber += 1;
      selected = null;
      $("budget").innerHTML = '<option>Nessun budget approvato</option>';
      $("version").innerHTML = $("revision").innerHTML = "";
      $("from").value = $("to").value = "";
      render();
    }
    showPage("variance");
  }

  $("budget").addEventListener("change", () => {
    const versions = approved().filter((budget) => family(budget) === $("budget").value);
    selectFamily(versions.find((budget) => budget.isOfficial) || versions.at(-1));
  });
  $("version").addEventListener("change", () => selectVersion(approved().find((budget) => budget.id === $("version").value), false));
  $("revision").addEventListener("change", render);
  $("filters").addEventListener("submit", (event) => { event.preventDefault(); render(); });
  $("rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-variance-toggle]");
    if (!button) return;
    const id = button.dataset.varianceToggle;
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    renderRows();
    [...$("rows").querySelectorAll("[data-variance-toggle]")].find((item) => item.dataset.varianceToggle === id)?.focus();
  });
  $("expand").addEventListener("click", expandAll);
  const showChartDetail = (event) => {
    const mark = event.target.closest("[data-chart-detail]");
    if (mark) mark.closest(".variance-chart").querySelector("[data-chart-readout]").textContent = mark.dataset.chartDetail;
  };
  $("charts").addEventListener("pointerover", showChartDetail);
  $("charts").addEventListener("focusin", showChartDetail);
  $("collapse").addEventListener("click", () => { expanded.clear(); renderRows(); });
  $("back").addEventListener("click", () => showPage("management"));
  return { open };
}
