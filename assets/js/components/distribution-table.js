export function distributionRowsHtml(
  total,
  duration,
  stepMonths,
  startDate,
  formatDate,
) {
  const baseCents = Math.floor((total * 100) / duration);
  let assigned = 0;
  return Array.from({ length: duration }, (_, index) => {
    const cents =
      index === duration - 1 ? Math.round(total * 100) - assigned : baseCents;
    assigned += cents;
    const date = new Date(startDate.getTime());
    date.setMonth(date.getMonth() + stepMonths * index);
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return `<tr><td data-distribution-date="${localDate}">${formatDate(date)}</td><td><input class="distribution-amount" type="number" step="0.01" value="${(cents / 100).toFixed(2)}" aria-label="Importo rata ${index + 1}"></td></tr>`;
  }).join("");
}
