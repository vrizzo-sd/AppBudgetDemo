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
    const matchesStructure =
      structure === "all" ||
      budget.name.toLowerCase().includes(structure.toLowerCase()) ||
      (structure === "Investimenti" && budget.type === "Investimento");
    const matchesStatus = status === "all" || budget.state === status;
    const searchableBudget = [
      budget.year,
      budget.name,
      budget.version,
      budget.frequency,
      budget.revision,
      budget.typology,
      budget.state,
      budget.type,
    ];
    const matchesSearch =
      !searchTerm ||
      searchableBudget.some((value) => normalized(value).includes(searchTerm)) ||
      budget.children.some((child) =>
        [child.code, child.name, child.state].some((value) =>
          normalized(value).includes(searchTerm),
        ),
      );
    return matchesStructure && matchesStatus && matchesSearch;
  });

  if (!filtered.length) {
    return '<tr><td colspan="10" class="center muted">Nessun budget corrisponde ai filtri.</td></tr>';
  }

  return filtered
    .map((budget) => {
      const budgetMatchesSearch =
        !searchTerm ||
        [
          budget.year,
          budget.name,
          budget.version,
          budget.frequency,
          budget.revision,
          budget.typology,
          budget.state,
          budget.type,
        ].some((value) => normalized(value).includes(searchTerm));
      const visibleChildren = budgetMatchesSearch
        ? budget.children
        : budget.children.filter((child) =>
            [child.code, child.name, child.state].some((value) =>
              normalized(value).includes(searchTerm),
            ),
          );
      return `
    <tr class="budget-row">
      <td>${budget.year}</td><td>${escapeHtml(budget.name)}</td><td>${budget.version}</td><td>${escapeHtml(budget.frequency)}</td><td>${budget.revision}</td><td>${escapeHtml(budget.typology)}</td><td>${budget.type === "Investimento" ? "Commessa di capitalizzazione" : "Livelli CDC"}</td><td><span class="status ${statusClass(budget.state)}">${escapeHtml(budget.state)}</span></td><td>${escapeHtml(budget.type)}</td>
      <td><button class="btn small" data-edit-budget="${budget.id}">Modifica intestazione</button> <button class="btn small green" data-add-level="${budget.id}">＋ Aggiungere voci</button> <button class="btn small blue" data-open-budget="${budget.id}">Apri analisi</button></td>
    </tr>
    ${visibleChildren.map((child) => `<tr class="child-row"><td colspan="6"></td><td><strong>${escapeHtml(child.code)}</strong> · ${escapeHtml(child.name)}</td><td><span class="status ${statusClass(child.state)}">${escapeHtml(child.state)}</span></td><td>${budget.type === "Investimento" ? "Investimento" : "Ordinario"}</td><td><button class="btn small icon" aria-label="Modifica ${escapeHtml(child.code)}" data-edit-child="${budget.id}|${child.id}">✎</button> <button class="btn small" data-open-child="${budget.id}|${child.id}">Analizza</button></td></tr>`).join("")}
  `;
    })
    .join("");
}
