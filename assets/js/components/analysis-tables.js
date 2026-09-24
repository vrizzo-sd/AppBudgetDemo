import { escapeHtml, euro, normalizeCode } from '../core/formatters.js';

export function levelRowsHtml(levels, rows, rowTotal, investment = false, sqlLevels = null) {
  return levels.map(level => {
    const code = normalizeCode(level.code);
    const summary = sqlLevels?.find(item => item.source_key === level.id);
    const costs = summary ? summary.cost_cents / 100 : rows.cost.filter(row => normalizeCode(row.code) === code).reduce((sum, row) => sum + rowTotal(row), 0);
    const revenue = summary ? summary.revenue_cents / 100 : rows.revenue.filter(row => normalizeCode(row.code) === code).reduce((sum, row) => sum + rowTotal(row), 0);
    const fundingSource = investment ? `<td><input class="level-funding-source" data-level-source="${escapeHtml(level.id)}" aria-label="Fonte di finanziamento di ${escapeHtml(level.name)}" maxlength="120" value="${escapeHtml(level.fundingSource || 'Da definire')}"></td>` : '';
    return `<tr><td>${escapeHtml(level.code)}</td><td>${escapeHtml(level.name)}</td>${fundingSource}<td class="num">${euro.format(revenue)}</td><td class="num">${euro.format(costs)}</td></tr>`;
  }).join('');
}

export function voiceRowsHtml(rows, rowTotal, sqlItems = null) {
  const allRows = [
    ...rows.cost.map(row => ({ ...row, nature: 'Costo' })),
    ...rows.revenue.map(row => ({ ...row, nature: 'Ricavo' }))
  ];
  return allRows.map(row => {
    const summary = sqlItems?.find(item => item.source_key === row.id);
    const total = summary ? summary.updated_amount_cents / 100 : rowTotal(row);
    return `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.voice)}</td><td>${escapeHtml(row.account)}</td><td>12 mesi</td><td class="num">${row.nature === 'Ricavo' ? euro.format(total) : '—'}</td><td class="num">${row.nature === 'Costo' ? euro.format(total) : '—'}</td></tr>`;
  }).join('');
}

export function monthlyRowsHtml(rows, rowTotal, approvedAdjustment) {
  return rows.map(row => {
    const monthCells = row.values.map((base, index) => {
      const delta = approvedAdjustment(row.id, index);
      return `<td class="num">${euro.format(base + delta)}${delta ? `<span class="delta">rett. ${delta > 0 ? '+' : ''}${euro.format(delta)}</span>` : ''}</td>`;
    }).join('');
    return `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.voice)}</td><td>${escapeHtml(row.account)}</td>${monthCells}<td class="num"><strong>${euro.format(rowTotal(row))}</strong></td><td><button class="btn small" data-distribute-row="${row.id}">Ripartisci</button> <button class="btn small" data-adjust-row="${row.id}">Proponi rettifica</button></td></tr>`;
  }).join('');
}

export function monthlyTotalHtml(title, total) {
  return `<tr class="total-row"><td colspan="16">TOTALE COMPLESSIVO ${title}</td><td class="num">${euro.format(total)}</td><td></td></tr>`;
}
