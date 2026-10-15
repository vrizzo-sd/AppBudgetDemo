import { escapeHtml, statusClass } from "../core/formatters.js";

function normalized(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function budgetRowsHtml(budgets, structure, status, search = "") {
  const searchTerm = normalized(search.trim());
  const filtered = budgets.filter((budget) => {
    const associatedStructure = budget.associatedStructure || "";
    const matchesStructure =
      structure === "all" ||
      budget.name.toLowerCase().includes(structure.toLowerCase()) ||
      normalized(associatedStructure).includes(normalized(structure)) ||
      (structure === "Investimenti" && budget.type === "Investimento");
    const matchesStatus = status === "all" || (budget.workflowState || "Bozza") === status;
    const searchableBudget = [
      budget.year,
      budget.name,
      budget.version,
      budget.frequency,
      budget.revision,
      associatedStructure,
      budget.type,
      budget.workflowState || "Bozza",
      budget.isOfficial ? "Ufficiale" : "",
    ];
    const matchesSearch =
      !searchTerm ||
      searchableBudget.some((value) => normalized(value).includes(searchTerm));
    return matchesStructure && matchesStatus && matchesSearch;
  });

  if (!filtered.length) {
    return '<tr><td colspan="8" class="center muted">Nessun budget corrisponde ai filtri.</td></tr>';
  }

  return filtered
    .map((budget) => {
      const associatedStructure = budget.associatedStructure || "";
      return `
    <tr class="budget-row ${budget.isOfficial ? "budget-row-active" : "budget-row-inactive"}">
      <td>${budget.year}</td><td>${escapeHtml(budget.name)}</td><td>${budget.version}</td><td>${escapeHtml(budget.frequency)}</td><td>${budget.revision}</td><td>${escapeHtml(associatedStructure)}</td>
      <td><span class="status ${statusClass(budget.workflowState || "Bozza")}">${escapeHtml(budget.workflowState || "Bozza")}</span>${budget.isOfficial ? '<span class="official-badge">Ufficiale</span>' : ""}</td>
      <td class="budget-actions"><button class="action-icon" type="button" aria-label="Modifica ${escapeHtml(budget.name)}, versione ${budget.version}" title="Modifica bozza" data-edit-budget="${budget.id}" ${budget.workflowState !== "Bozza" ? "disabled" : ""}>✎</button> <button class="action-icon" type="button" aria-label="Copia ${escapeHtml(budget.name)}, versione ${budget.version}" title="Nuova versione" data-copy-budget="${budget.id}">⧉</button> <button class="action-icon danger" type="button" aria-label="Elimina ${escapeHtml(budget.name)}, versione ${budget.version}" title="Elimina bozza" data-delete-budget="${budget.id}" ${budget.workflowState !== "Bozza" ? "disabled" : ""}>🗑</button> <button class="btn small blue" type="button" data-open-budget="${budget.id}">Redazione</button> <button class="btn small" type="button" data-open-variance="${escapeHtml(budget.id)}" ${budget.workflowState !== "Approvato" || !budget.revisions?.length ? 'disabled title="Disponibile dopo l’approvazione del budget"' : ""}>Scostamenti</button></td>
    </tr>
  `;
    })
    .join("");
}
