import { escapeHtml, euroCents, months } from "../core/formatters.js";

const W = 1000;
const compact = new Intl.NumberFormat("it-IT", { notation: "compact", maximumFractionDigits: 1 });
const amount = (value) => value === null ? "non disponibile" : euroCents.format(value);
const detail = (label, row) => `${label} · Budget aggiornato: ${amount(row.updated)} · Consuntivo: ${amount(row.actual)}`;
const legend = '<div class="variance-chart-legend"><span><i class="chart-budget-key"></i>Budget aggiornato</span><span><i class="chart-actual-key"></i>Consuntivo</span></div>';

export function varianceChartScale(values) {
  const finite = values.filter((value) => value !== null && Number.isFinite(value));
  let low = Math.min(0, ...finite), high = Math.max(0, ...finite);
  if (low === high) high = low + 1;
  const raw = (high - low) / 4, power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((value) => value * power >= raw) * power;
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, index) => low + index * step);
  return { low, high, ticks };
}

const datum = (label, content) => `<g class="variance-chart-datum" tabindex="0" role="img" aria-label="${escapeHtml(label)}" data-chart-detail="${escapeHtml(label)}">${content}</g>`;

function figure(id, title, subtitle, chart, note = "") {
  return `<figure class="panel variance-chart" aria-labelledby="${id}-title"><figcaption class="panel-title" id="${id}-title">${title}</figcaption>
    <div class="variance-chart-body"><p class="muted variance-chart-subtitle">${subtitle}</p>${legend}
    <div class="variance-chart-scroll">${chart}</div>
    ${note ? `<p class="variance-chart-note">${note}</p>` : ""}
    <p class="variance-chart-detail" role="status" aria-live="polite" data-chart-readout>Passa sui dati o selezionali con Tab per leggere gli importi esatti.</p></div></figure>`;
}

function barChart(rows) {
  const left = 280, right = 790, top = 52, rowHeight = 56, height = top + rows.length * rowHeight + 14;
  const scale = varianceChartScale(rows.flatMap((row) => [row.updated, row.actual]));
  const x = (value) => left + (value - scale.low) / (scale.high - scale.low) * (right - left);
  const grid = scale.ticks.map((value) => `<line class="variance-chart-grid" x1="${x(value)}" x2="${x(value)}" y1="34" y2="${height - 8}"/><text class="variance-chart-tick" x="${x(value)}" y="24" text-anchor="middle">${escapeHtml(compact.format(value))} €</text>`).join("");
  const marks = rows.map((row, index) => {
    const y = top + index * rowHeight, fullLabel = `${row.code} · ${row.name}`;
    const shortened = row.name.length > 31 ? `${row.name.slice(0, 30)}…` : row.name;
    const bars = ["updated", "actual"].map((key, series) => {
      const value = row[key], py = y + series * 19;
      return `${value === null ? "" : `<rect class="chart-${series === 0 ? "budget" : "actual"}-bar" x="${Math.min(x(0), x(value))}" y="${py}" width="${Math.abs(x(value) - x(0))}" height="12"/>`}
        <text class="variance-chart-value" x="985" y="${py + 11}" text-anchor="end">${value === null ? "—" : escapeHtml(euroCents.format(value))}</text>`;
    }).join("");
    return datum(detail(fullLabel, row), `<rect class="variance-chart-hit" x="0" y="${y - 5}" width="1000" height="48"/><text class="variance-chart-label" x="12" y="${y + 9}">${escapeHtml(row.code)}</text><text class="variance-chart-label" x="12" y="${y + 28}">${escapeHtml(shortened)}</text>${bars}`);
  }).join("");
  return `<svg class="variance-bars-svg" viewBox="0 0 ${W} ${height}" role="group" aria-label="Budget aggiornato e consuntivo per singola voce, in euro">${grid}<line class="variance-chart-axis" x1="${x(0)}" x2="${x(0)}" y1="34" y2="${height - 8}"/>${marks}</svg>`;
}

function lineChart(rows) {
  const left = 80, right = 710, top = 22, bottom = 190;
  const scale = varianceChartScale(rows.flatMap((row) => [row.updated, row.actual]));
  const x = (index) => rows.length === 1 ? (left + right) / 2 : left + index / (rows.length - 1) * (right - left);
  const y = (value) => bottom - (value - scale.low) / (scale.high - scale.low) * (bottom - top);
  const grid = scale.ticks.map((value) => `<line class="variance-chart-grid" x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}"/><text class="variance-chart-tick" x="${left - 12}" y="${y(value) + 5}" text-anchor="end">${escapeHtml(compact.format(value))} €</text>`).join("");
  const tickCount = Math.min(5, rows.length);
  const tickIndices = new Set(Array.from({ length: tickCount }, (_, index) => Math.round(index * (rows.length - 1) / Math.max(1, tickCount - 1))));
  const labels = [...tickIndices].map((index) => `<text class="variance-chart-tick" x="${x(index)}" y="228" text-anchor="middle">${months[rows[index].month]} ${rows[index].year}</text>`).join("");
  const lines = ["updated", "actual"].map((key) => {
    let drawing = false;
    const path = rows.map((row, index) => {
      if (row[key] === null) { drawing = false; return ""; }
      const segment = `${drawing ? "L" : "M"}${x(index)},${y(row[key])}`;
      drawing = true;
      return segment;
    }).join(" ");
    return `<path class="chart-${key === "updated" ? "budget" : "actual"}-line" d="${path}"/>`;
  }).join("");
  const points = rows.map((row, index) => datum(detail(`${months[row.month]} ${row.year}`, row),
    `<rect class="variance-chart-hit" x="${x(index) - 14}" y="${top}" width="28" height="${bottom - top}"/>
    <circle class="chart-budget-point" cx="${x(index)}" cy="${y(row.updated)}" r="4"/>
    ${row.actual === null ? "" : `<rect class="chart-actual-point" x="${x(index) - 4}" y="${y(row.actual) - 4}" width="8" height="8"/>`}`)).join("");
  return `<svg class="variance-line-svg" viewBox="0 0 760 250" role="group" aria-label="Andamento mensile di budget aggiornato e consuntivo, in euro">${grid}<line class="variance-chart-axis" x1="${left}" x2="${left}" y1="${top}" y2="${bottom}"/><line class="variance-chart-axis" x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}"/>${labels}${lines}${points}</svg>`;
}

export function varianceChartsHtml({ voices, monthly }) {
  return figure("variance-voices-chart", "Budget aggiornato e consuntivo per voce", "Importi del periodo selezionato · tutte le voci pianificate · euro", barChart(voices), voices.some((row) => row.actual === null) ? "— indica un consuntivo non disponibile per l’intero periodo della voce." : "") +
    figure("variance-monthly-chart", "Andamento mensile", "Totale del budget selezionato · importi del singolo mese · euro", lineChart(monthly), monthly.some((row) => row.actual === null) ? "La linea del consuntivo si interrompe nei mesi senza dati completi." : "");
}
