import { clone, escapeHtml, euro, months, normalizeCode, statusClass } from './core/formatters.js';
import { budgetRowsHtml } from './components/budget-list.js';
import { levelRowsHtml, monthlyRowsHtml, monthlyTotalHtml, voiceRowsHtml } from './components/analysis-tables.js';
import { capexHeadHtml, capexRowsHtml, capexTotalHtml, capexTotals } from './components/capex-table.js';
import { adjustmentListHtml } from './components/adjustment-list.js';
import { distributionRowsHtml } from './components/distribution-table.js';
import { capexComponentsDefault, defaultBudgets, investmentDemoRows, ordinaryDemoRows } from './data/demo-data.js';

(() => {
  'use strict';

  let ordinaryRows = load('wg-mockup-ordinary-rows', ordinaryDemoRows);
  let investmentRows = load('wg-mockup-investment-rows', investmentDemoRows);

  let budgets = load('wg-mockup-budgets', defaultBudgets);
  let adjustments = load('wg-mockup-adjustments', [
    { id:'RET-0042', scope:'economic', nature:'cost', rowId:'c2', rowLabel:'Energia elettrica', month:0, amount:5000, reason:'Aumento tariffa energia', attachment:'preventivo.pdf', status:'In approvazione' },
    { id:'RET-0038', scope:'capex', nature:'cost', rowId:'cp2', rowLabel:'Impianti elettrici', month:8, amount:20000, reason:'Adeguamento quadro elettrico', attachment:'offerta.pdf', status:'Approvata' }
  ]);
  let capexComponents = load('wg-mockup-capex', capexComponentsDefault);
  let currentBudget = budgets[0];
  let currentChild = currentBudget.children[0];
  let analysisScope = 'child';
  let currentNature = 'cost';
  let editing = null;
  let editingComponentId = null;
  let redistributionRowId = null;
  let redistributionNature = 'cost';
  let apiAvailable = false;
  let apiSaveTimer = null;
  let stateVersion = 0;

  function normalizePayments(payments) {
    if (payments?.length === 12) return payments.map(value => Number(value) || 0);
    const monthly = Array(12).fill(0);
    if (payments?.length === 4) [2, 5, 8, 10].forEach((month, index) => { monthly[month] = Number(payments[index]) || 0; });
    return monthly;
  }

  function ensureFundingSources() {
    budgets.filter(budget => budget.type === 'Investimento').forEach(budget => budget.children.forEach(level => {
      if (level.fundingSource) return;
      const sources = [...new Set(capexComponents.filter(component => normalizeCode(component.project) === normalizeCode(level.code))
        .map(component => component.source?.trim()).filter(Boolean))];
      level.fundingSource = sources.length === 1 ? sources[0] : sources.length > 1 ? 'Fonti miste' : 'Da definire';
    }));
  }

  function ensureCompleteDemoRows() {
    [[ordinaryRows, ordinaryDemoRows], [investmentRows, investmentDemoRows]].forEach(([target, source]) => {
      ['cost', 'revenue'].forEach(nature => {
        const existingIds = new Set((target[nature] || []).map(row => row.id));
        target[nature] = target[nature] || [];
        source[nature].forEach(row => {
          if (!existingIds.has(row.id)) target[nature].push(clone(row));
        });
      });
    });
    const componentIds = new Set(capexComponents.map(component => component.id));
    capexComponentsDefault.forEach(component => {
      if (!componentIds.has(component.id)) capexComponents.push(clone(component));
    });
    capexComponents.forEach(component => {
      const canonical = capexComponentsDefault.find(item => item.id === component.id);
      if (canonical?.budgetRowId && !component.budgetRowId) component.budgetRowId = canonical.budgetRowId;
      component.payments = normalizePayments(component.payments);
    });
    ensureFundingSources();
  }
  ensureCompleteDemoRows();

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || clone(fallback); }
    catch { return clone(fallback); }
  }
  function persist() {
    const version = ++stateVersion;
    try {
      localStorage.setItem('wg-mockup-budgets', JSON.stringify(budgets));
      localStorage.setItem('wg-mockup-adjustments', JSON.stringify(adjustments));
      localStorage.setItem('wg-mockup-capex', JSON.stringify(capexComponents));
      localStorage.setItem('wg-mockup-ordinary-rows', JSON.stringify(ordinaryRows));
      localStorage.setItem('wg-mockup-investment-rows', JSON.stringify(investmentRows));
    } catch {}
    if (apiAvailable) {
      clearTimeout(apiSaveTimer);
      apiSaveTimer = setTimeout(() => {
        fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budgets, adjustments, capexComponents, ordinaryRows, investmentRows })
        }).then(response => {
          if (!response.ok) toast('Salvataggio SQLite non riuscito');
          else refreshSqlSummaries(version);
        }).catch(() => { apiAvailable = false; toast('Connessione SQLite non disponibile'); });
      }, 120);
    }
  }
  async function hydrateFromServer() {
    try {
      const response = await fetch('/api/state', { headers: { 'Accept': 'application/json' } });
      if (!response.ok) return;
      const state = await response.json();
      apiAvailable = true;
      if (Array.isArray(state.budgets) && state.budgets.length) {
        budgets = state.budgets;
        adjustments = Array.isArray(state.adjustments) ? state.adjustments : adjustments;
        capexComponents = Array.isArray(state.capexComponents) ? state.capexComponents : capexComponents;
        ordinaryRows = state.ordinaryRows || ordinaryRows;
        investmentRows = state.investmentRows || investmentRows;
        ensureCompleteDemoRows();
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
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function showPage(name) {
    $$('.page').forEach(page => page.classList.toggle('active', page.id === `page-${name}`));
    $('#page-title').textContent = name === 'management' ? 'Gestione Budget Analitica' : 'Redazione Budget Analitica';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderBudgets() {
    const structure = $('#filter-structure').value;
    const status = $('#filter-status').value;
    $('#budget-list').innerHTML = budgetRowsHtml(budgets, structure, status);
  }

  function rowsForCurrent() {
    const source = currentBudget.type === 'Investimento' ? investmentRows : ordinaryRows;
    const allowedCodes = new Set((analysisScope === 'child' ? [currentChild] : currentBudget.children).map(child => normalizeCode(child?.code)));
    return {
      cost: source.cost.filter(row => allowedCodes.has(normalizeCode(row.code))),
      revenue: source.revenue.filter(row => allowedCodes.has(normalizeCode(row.code)))
    };
  }
  function getApprovedAdjustment(rowId, month) {
    return adjustments.filter(a => a.scope === 'economic' && a.rowId === rowId && a.month === month && a.status === 'Approvata').reduce((sum, a) => sum + Number(a.amount), 0);
  }
  function rowTotal(row) { return row.values.reduce((sum, value, index) => sum + value + getApprovedAdjustment(row.id, index), 0); }

  function openAnalysis(budgetId, childId) {
    currentBudget = budgets.find(b => b.id === budgetId) || budgets[0];
    currentChild = currentBudget.children.find(c => c.id === childId) || currentBudget.children[0];
    analysisScope = childId ? 'child' : 'budget';
    currentNature = 'cost';
    $('#analysis-name').textContent = analysisScope === 'budget' ? currentBudget.name : currentChild.name;
    $('#analysis-code').textContent = analysisScope === 'budget' ? `Budget ${currentBudget.name}` : currentChild.code;
    $('#analysis-period').textContent = currentBudget.year;
    $('#analysis-status').textContent = analysisScope === 'budget' ? currentBudget.state : currentChild.state;
    $('#analysis-status').className = `status ${statusClass(analysisScope === 'budget' ? currentBudget.state : currentChild.state)}`;
    $('#analysis-type').value = currentBudget.type;
    $('#analysis-budget-field').innerHTML = budgets.filter(budget => budget.type === currentBudget.type)
      .map(budget => `<option value="${escapeHtml(budget.id)}">${escapeHtml(budget.name)} ${budget.year}</option>`).join('');
    $('#analysis-budget-field').value = currentBudget.id;
    $('#analysis-structure-field').value = analysisScope === 'budget' ? `Tutti i livelli (${currentBudget.children.length})` : currentChild.name;
    $('#analysis-frequency').value = currentBudget.frequency === 'Vita utile' ? 'Annuale' : currentBudget.frequency;
    $('#analysis-duration').value = '12 mesi (anno)';
    $('#capex-panel').hidden = currentBudget.type !== 'Investimento';
    renderAnalysis();
    showPage('analysis');
    refreshSqlSummaries();
  }

  function renderAnalysis() {
    const rows = rowsForCurrent();
    const visibleLevels = analysisScope === 'budget' ? currentBudget.children : [currentChild];
    const investment = currentBudget.type === 'Investimento';
    $('#level-head').innerHTML = `<th>Codice</th><th>Descrizione</th>${investment ? '<th>Fonte di finanziamento</th>' : ''}<th class="num">Tot. ricavi</th><th class="num">Tot. costi</th>`;
    $('#level-table').innerHTML = levelRowsHtml(visibleLevels, rows, rowTotal, investment);
    $('#voice-table').innerHTML = voiceRowsHtml(rows, rowTotal);
    renderMonthly();
    renderCapex();
    renderAdjustments();
  }

  async function refreshSqlSummaries(version = stateVersion) {
    if (!apiAvailable || !$('#page-analysis').classList.contains('active')) return;
    const budgetId = currentBudget.id;
    try {
      const response = await fetch(`/api/analysis?budgetId=${encodeURIComponent(budgetId)}`);
      if (!response.ok) return;
      const summary = await response.json();
      if (version !== stateVersion || budgetId !== currentBudget.id || !$('#page-analysis').classList.contains('active')) return;
      const rows = rowsForCurrent();
      const levels = analysisScope === 'budget' ? currentBudget.children : [currentChild];
      $('#level-table').innerHTML = levelRowsHtml(levels, rows, rowTotal, currentBudget.type === 'Investimento', summary.levels);
      $('#voice-table').innerHTML = voiceRowsHtml(rows, rowTotal, summary.items);
    } catch { /* Il calcolo locale resta disponibile se il server SQL non risponde. */ }
  }

  function renderMonthly() {
    const rows = rowsForCurrent()[currentNature];
    const title = currentNature === 'cost' ? 'COSTI' : 'RICAVI';
    const grand = rows.reduce((sum, row) => sum + rowTotal(row), 0);
    $('#grand-total').textContent = `TOTALE ${title}: ${euro.format(grand)}`;
    $('#monthly-table').innerHTML = monthlyRowsHtml(rows, rowTotal, getApprovedAdjustment);
    $('#monthly-foot').innerHTML = monthlyTotalHtml(title, grand);
    $$('[data-nature-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.natureTab === currentNature)));
  }

  function capexForCurrent() {
    if (currentBudget.type !== 'Investimento') return [];
    const allowedProjects = new Set((analysisScope === 'child' ? [currentChild] : currentBudget.children).map(child => normalizeCode(child?.code)));
    return capexComponents.filter(component => {
      const isEmptyPlaceholder = component.component === 'Nuovo componente' && component.approved === 0 && component.adjustment === 0 && component.payments.every(value => value === 0);
      return allowedProjects.has(normalizeCode(component.project)) && !isEmptyPlaceholder;
    });
  }

  function renderCapex() {
    const visibleComponents = capexForCurrent();
    $('#capex-scope-label').textContent = analysisScope === 'budget'
      ? `Commesse di ${currentBudget.name}`
      : `${currentChild.code} · ${currentChild.name}`;
    $('#capex-head').innerHTML = capexHeadHtml(currentBudget.year);
    $('#capex-table').innerHTML = capexRowsHtml(visibleComponents);
    $('#capex-foot').innerHTML = capexTotalHtml(capexTotals(visibleComponents));
  }

  function openVoiceModal() {
    const levels = analysisScope === 'budget' ? currentBudget.children : [currentChild];
    $('#voice-form').reset();
    $('#voice-level').innerHTML = levels.map(level => `<option value="${escapeHtml(level.code)}">${escapeHtml(level.code)} · ${escapeHtml(level.name)}</option>`).join('');
    $('#voice-nature').value = currentNature;
    $('#voice-description').setCustomValidity('');
    $('#voice-account').setCustomValidity('');
    $('#voice-investment-note').hidden = currentBudget.type !== 'Investimento';
    updateVoiceAccounts();
    updateVoicePreview();
    $('#voice-modal').classList.add('open');
    $('#voice-modal').setAttribute('aria-hidden', 'false');
  }

  function closeVoiceModal() {
    $('#voice-modal').classList.remove('open');
    $('#voice-modal').setAttribute('aria-hidden', 'true');
  }

  function updateVoiceAccounts() {
    const nature = $('#voice-nature').value;
    const accounts = [...new Set([...ordinaryRows[nature], ...investmentRows[nature]].map(row => row.account))].sort();
    $('#voice-accounts').innerHTML = accounts.map(account => `<option value="${escapeHtml(account)}"></option>`).join('');
  }

  function scheduledMonths() {
    const start = Number($('#voice-start-month').value);
    const interval = Number($('#voice-frequency').value);
    const months = [];
    for (let month = start; month < 12; month += interval || 12) months.push(month);
    return months;
  }

  function updateVoicePreview() {
    const amount = Number($('#voice-total').value || 0);
    const count = scheduledMonths().length;
    $('#voice-preview').textContent = amount > 0
      ? `${euro.format(amount)} ripartiti in ${count} ${count === 1 ? 'scadenza' : 'scadenze'} nel ${currentBudget.year}. Dopo il salvataggio puoi modificare i mesi con “Ripartisci”.`
      : 'Inserisci l’importo: la ripartizione apparirà nella tabella 3.';
  }

  function addBudgetVoice(event) {
    event.preventDefault();
    const level = currentBudget.children.find(child => child.code === $('#voice-level').value);
    if (!level) return;
    const source = currentBudget.type === 'Investimento' ? investmentRows : ordinaryRows;
    const nature = $('#voice-nature').value;
    const voice = $('#voice-description').value.trim();
    const account = $('#voice-account').value.trim();
    const totalCents = Math.round(Number($('#voice-total').value) * 100);
    if (!voice) {
      $('#voice-description').setCustomValidity('Inserisci il nome della voce.');
      $('#voice-description').reportValidity();
      return;
    }
    if (!account) {
      $('#voice-account').setCustomValidity('Seleziona o inserisci un sottoconto.');
      $('#voice-account').reportValidity();
      return;
    }
    const allRows = [ordinaryRows, investmentRows];
    if (allRows.some(rows => rows[nature === 'cost' ? 'revenue' : 'cost'].some(row => row.account === account))) {
      $('#voice-account').setCustomValidity('Questo sottoconto è già usato con la natura opposta.');
      $('#voice-account').reportValidity();
      return;
    }
    if (source[nature].some(row => normalizeCode(row.code) === normalizeCode(level.code)
        && row.account === account && row.voice.toLowerCase() === voice.toLowerCase())) {
      $('#voice-description').setCustomValidity('Questa voce con lo stesso sottoconto esiste già nel livello.');
      $('#voice-description').reportValidity();
      return;
    }
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return;
    const months = scheduledMonths();
    const values = Array(12).fill(0);
    const baseCents = Math.floor(totalCents / months.length);
    const remainder = totalCents % months.length;
    months.forEach((month, index) => { values[month] = (baseCents + (index < remainder ? 1 : 0)) / 100; });
    source[nature].push({ id:`voice-${crypto.randomUUID()}`, code:level.code, description:level.name, voice, account, values });
    currentNature = nature;
    renderAnalysis();
    persist();
    closeVoiceModal();
    toast(`${nature === 'cost' ? 'Costo' : 'Ricavo'} aggiunto: tabelle e totali aggiornati`);
  }

  function updateComponentPreview() {
    const amount = Number($('#component-amount').value || 0);
    const adjustment = Number($('#component-adjustment').value || 0);
    const updated = amount + adjustment;
    const scheduled = $$('[data-payment-month]').reduce((sum, input) => sum + Number(input.value || 0), 0);
    $('#component-updated').value = updated.toFixed(2);
    $('#component-payment-summary').textContent = `Pagamenti pianificati: ${euro.format(scheduled)} di ${euro.format(updated)} · Differenza: ${euro.format(updated - scheduled)}`;
    $('#component-payment-summary').classList.toggle('invalid', Math.round((updated - scheduled) * 100) !== 0);
    $('#component-amount').setCustomValidity('');
  }

  function scaleMonthlyValues(values, targetCents) {
    const original = values.map(value => Math.round(Number(value || 0) * 100));
    const originalTotal = original.reduce((sum, value) => sum + value, 0);
    if (!originalTotal) {
      const next = Array(12).fill(0);
      next[0] = targetCents / 100;
      return next;
    }
    const fractions = original.map((value, index) => ({ index, exact: value * targetCents / originalTotal }));
    const nextCents = fractions.map(item => Math.floor(item.exact));
    let remaining = targetCents - nextCents.reduce((sum, value) => sum + value, 0);
    fractions.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
    for (let index = 0; index < remaining; index++) nextCents[fractions[index].index]++;
    return nextCents.map(value => value / 100);
  }

  function openComponentModal(componentId = null) {
    const projects = analysisScope === 'budget' ? currentBudget.children : [currentChild];
    const component = componentId ? capexForCurrent().find(item => item.id === componentId) : null;
    if (componentId && !component) return;
    const linkedRow = component && investmentRows.cost.find(row => row.id === component.budgetRowId);
    if (component && !linkedRow) { toast('Voce di budget collegata non trovata: modifica non disponibile'); return; }
    editingComponentId = component?.id || null;
    $('#component-form').reset();
    $('#component-project').innerHTML = projects.map(project => `<option value="${escapeHtml(project.code)}">${escapeHtml(project.code)} · ${escapeHtml(project.name)}</option>`).join('');
    $('#component-modal-title').textContent = component ? `Modifica voce CAPEX · ${component.component}` : 'Nuova voce CAPEX';
    $('#component-submit').textContent = component ? 'Salva modifiche' : 'Aggiungi voce';
    $('#component-project').value = component?.project || projects[0]?.code || '';
    $('#component-description').value = component?.component || '';
    $('#component-account').value = linkedRow?.account || '';
    $('#component-source').value = component?.source || '';
    $('#component-life').value = component?.life || '';
    $('#component-state').value = component?.state || 'Pianificato';
    $('#component-amount').value = component?.approved ?? '';
    $('#component-adjustment').value = component?.adjustment || 0;
    $('#component-depreciation').value = component?.depreciation ?? 0;
    $('#component-payment-fields').innerHTML = months.map((month, index) => `<div class="field"><label for="payment-${index}">${month} (€)</label><input id="payment-${index}" data-payment-month="${index}" type="number" min="0" step="0.01" value="${component?.payments[index] ?? 0}" required></div>`).join('');
    $('#component-amount').setCustomValidity('');
    $('#component-description').setCustomValidity('');
    $('#component-account').setCustomValidity('');
    updateComponentPreview();
    $('#component-modal').classList.add('open');
    $('#component-modal').setAttribute('aria-hidden', 'false');
  }

  function closeComponentModal() {
    $('#component-modal').classList.remove('open');
    $('#component-modal').setAttribute('aria-hidden', 'true');
    editingComponentId = null;
  }

  function saveInvestmentComponent(event) {
    event.preventDefault();
    const project = currentBudget.children.find(child => child.code === $('#component-project').value);
    if (!project) return;
    const component = editingComponentId ? capexComponents.find(item => item.id === editingComponentId) : null;
    const linkedRow = component && investmentRows.cost.find(row => row.id === component.budgetRowId);
    if (editingComponentId && (!component || !linkedRow)) { toast('Voce di budget collegata non trovata'); return; }
    const description = $('#component-description').value.trim();
    const account = $('#component-account').value.trim();
    const amount = Number($('#component-amount').value);
    const adjustment = component ? Number(component.adjustment || 0) : 0;
    const payments = $$('[data-payment-month]').map(input => Number(input.value));
    const duplicate = investmentRows.cost.some(row => normalizeCode(row.code) === normalizeCode(project.code)
      && row.id !== linkedRow?.id && row.account === account && row.voice.toLowerCase() === description.toLowerCase());
    if (duplicate) {
      $('#component-description').setCustomValidity('Questa voce con lo stesso sottoconto esiste già nella commessa.');
      $('#component-description').reportValidity();
      return;
    }
    if ([ordinaryRows, investmentRows].some(rows => rows.revenue.some(row => row.account === account))) {
      $('#component-account').setCustomValidity('Questo sottoconto è già usato per un ricavo.');
      $('#component-account').reportValidity();
      return;
    }
    const updatedCents = Math.round((amount + adjustment) * 100);
    if (updatedCents <= 0 || Math.round(payments.reduce((sum, value) => sum + value, 0) * 100) !== updatedCents) {
      $('#component-amount').setCustomValidity('La somma dei pagamenti deve coincidere con il CAPEX aggiornato.');
      $('#component-amount').reportValidity();
      return;
    }
    const row = linkedRow || { id:`ic${crypto.randomUUID()}` };
    const approvedEconomicCents = linkedRow ? Array.from({ length: 12 }, (_, month) => getApprovedAdjustment(linkedRow.id, month))
      .reduce((sum, value) => sum + Math.round(value * 100), 0) : 0;
    const targetBaseCents = updatedCents - approvedEconomicCents;
    if (targetBaseCents < 0) {
      $('#component-amount').setCustomValidity('Il CAPEX aggiornato non può essere inferiore alle rettifiche economiche già approvate.');
      $('#component-amount').reportValidity();
      return;
    }
    const values = linkedRow ? scaleMonthlyValues(linkedRow.values, targetBaseCents) : payments.slice();
    Object.assign(row, { code:project.code, description:project.name, voice:description, account, values });
    if (!linkedRow) investmentRows.cost.push(row);
    const capex = component || { id:`cp${crypto.randomUUID()}`, budgetRowId:row.id, adjustment:0 };
    Object.assign(capex, {
      project:project.code, component:description, category:component?.category || 'Da definire',
      source:$('#component-source').value.trim(), life:Number($('#component-life').value),
      state:$('#component-state').value, payments, approved:amount,
      depreciation:Number($('#component-depreciation').value)
    });
    if (!component) capexComponents.push(capex);
    persist();
    renderAnalysis();
    closeComponentModal();
    toast(component ? 'Componente e totali del budget aggiornati' : 'Voce di investimento aggiunta al budget e al dettaglio CAPEX');
  }

  function openEdit(type, budgetId, childId) {
    const budget = budgets.find(b => b.id === budgetId);
    const child = childId ? budget.children.find(c => c.id === childId) : null;
    editing = { type, budgetId, childId };
    $('#edit-modal-title').textContent = type === 'new' ? 'Crea nuovo budget' : child ? `Modifica livello ${child.code}` : `Modifica intestazione ${budget.name}`;
    $('#edit-modal-body').innerHTML = child ? `
      <div class="field"><label for="edit-code">Codice livello</label><input id="edit-code" name="code" value="${escapeHtml(child.code)}" required></div>
      <div class="field"><label for="edit-child-state">Stato</label><select id="edit-child-state" name="state"><option ${child.state==='Bozza'?'selected':''}>Bozza</option><option ${child.state==='Creato'?'selected':''}>Creato</option><option ${child.state==='Completato'?'selected':''}>Completato</option></select></div>
      <div class="field full"><label for="edit-child-name">Descrizione livello</label><input id="edit-child-name" name="name" value="${escapeHtml(child.name)}" required></div>
    ` : `
      <div class="field"><label for="edit-year">Anno</label><input id="edit-year" name="year" type="number" value="${budget?.year || 2027}" required></div>
      <div class="field"><label for="edit-name">Nome budget</label><input id="edit-name" name="name" value="${escapeHtml(budget?.name || 'NUOVO BUDGET')}" required></div>
      <div class="field"><label for="edit-version">Versione</label><input id="edit-version" name="version" type="number" value="${budget?.version || 1}" required></div>
      <div class="field"><label for="edit-revision">Revisione</label><input id="edit-revision" name="revision" type="number" value="${budget?.revision || 0}" required></div>
      <div class="field"><label for="edit-frequency">Periodicità</label><select id="edit-frequency" name="frequency"><option>Annuale</option><option>Mensile</option><option>Trimestrale</option><option>Vita utile</option></select></div>
      <div class="field"><label for="edit-type">Tipo budget</label><select id="edit-type" name="budgetType"><option>Ordinario</option><option>Investimento</option></select></div>
      <div class="field"><label for="edit-typology">Tipologia</label><select id="edit-typology" name="typology"><option>CDC</option><option>COMMESSA</option></select></div>
      <div class="field"><label for="edit-state">Stato</label><select id="edit-state" name="state"><option>Bozza</option><option>Creato</option><option>Completato</option></select></div>
    `;
    if (!child && budget) {
      $('#edit-frequency').value = budget.frequency; $('#edit-type').value = budget.type; $('#edit-typology').value = budget.typology; $('#edit-state').value = budget.state;
    }
    $('#edit-modal').classList.add('open'); $('#edit-modal').setAttribute('aria-hidden','false');
  }

  function closeModal() { $('#edit-modal').classList.remove('open'); $('#edit-modal').setAttribute('aria-hidden','true'); editing = null; }

  function adjustmentRows() {
    const rows = rowsForCurrent();
    return $('#adj-scope').value === 'capex' ? capexForCurrent().map(c => ({id:c.id, label:`${c.project} · ${c.component}`})) : rows[$('#adj-nature').value].map(r => ({id:r.id,label:`${r.code} · ${r.voice}`}));
  }
  function populateAdjustmentRows(selectedId) {
    const options = adjustmentRows();
    $('#adj-row').innerHTML = options.map(o => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('');
    if (selectedId && options.some(o => o.id === selectedId)) $('#adj-row').value = selectedId;
    updateAdjustmentPreview();
  }
  function updateAdjustmentPreview() {
    const scope = $('#adj-scope').value;
    const rowId = $('#adj-row').value;
    const month = Number($('#adj-month').value);
    const amount = Number($('#adj-amount').value || 0);
    let current = 0;
    if (scope === 'capex') {
      const comp = capexComponents.find(c => c.id === rowId); current = comp ? comp.approved + comp.adjustment : 0;
    } else {
      const row = rowsForCurrent()[$('#adj-nature').value].find(r => r.id === rowId); current = row ? row.values[month] + getApprovedAdjustment(row.id, month) : 0;
    }
    $('#adj-preview').textContent = `Budget attuale ${euro.format(current)} · Variazione ${amount >= 0 ? '+' : ''}${euro.format(amount)} · Nuovo budget ${euro.format(current + amount)}`;
  }
  function renderAdjustments() {
    $('#adjustment-count').textContent = `(${adjustments.length})`;
    $('#adjustment-list').innerHTML = adjustmentListHtml(adjustments);
  }
  function openAdjustments(rowId, scope='economic') {
    $('#adj-scope').value = scope;
    if (scope === 'economic') {
      const rows = rowsForCurrent();
      if (rows.revenue.some(r => r.id === rowId)) $('#adj-nature').value = 'revenue'; else $('#adj-nature').value = 'cost';
    }
    populateAdjustmentRows(rowId);
    renderAdjustments();
    $('#adjustment-drawer').classList.add('open'); $('#adjustment-drawer').setAttribute('aria-hidden','false');
  }
  function closeAdjustments() { $('#adjustment-drawer').classList.remove('open'); $('#adjustment-drawer').setAttribute('aria-hidden','true'); }

  function formatDate(date) {
    return new Intl.DateTimeFormat('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' }).format(date);
  }
  function renderDistributionSchedule() {
    const total = Number($('#dist-total').value || 0);
    const duration = Math.max(1, Math.min(120, Number($('#dist-duration').value || 1)));
    const stepMonths = Number($('#dist-periodicity').value || 1);
    const start = new Date(`${$('#dist-start').value || '2027-01-01'}T00:00:00`);
    $('#distribution-rows').innerHTML = distributionRowsHtml(total, duration, stepMonths, start, formatDate);
    updateDistributionSummary();
  }
  function updateDistributionSummary() {
    const sum = $$('.distribution-amount').reduce((total, input) => total + Number(input.value || 0), 0);
    $('#distribution-summary').textContent = `Importo ripartito: ${new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:2}).format(sum)} · ${$$('.distribution-amount').length} scadenze`;
  }
  function openRedistribution(rowId) {
    redistributionRowId = rowId;
    redistributionNature = currentNature;
    const row = rowsForCurrent()[currentNature].find(item => item.id === rowId);
    $('#redistribution-title').textContent = `Redistribuzione importo · ${row?.voice || ''}`;
    $('#dist-total').value = row ? row.values.reduce((sum, value) => sum + value, 0) : 0;
    $('#dist-total').setCustomValidity('');
    $('#dist-duration').value = 12;
    $('#dist-periodicity').value = '1';
    $('#dist-start').value = `${currentBudget.year}-01-01`;
    $('#dist-type').value = currentNature;
    renderDistributionSchedule();
    $('#redistribution-modal').classList.add('open');
    $('#redistribution-modal').setAttribute('aria-hidden','false');
  }
  function closeRedistribution() {
    $('#redistribution-modal').classList.remove('open');
    $('#redistribution-modal').setAttribute('aria-hidden','true');
    redistributionRowId = null;
  }
  function applyDistribution() {
    const row = rowsForCurrent()[redistributionNature].find(item => item.id === redistributionRowId);
    if (!row) return;
    const yearValues = Array(12).fill(0);
    $$('#distribution-rows tr').forEach(tr => {
      const date = new Date(`${tr.querySelector('[data-distribution-date]').dataset.distributionDate}T00:00:00`);
      if (date.getFullYear() === currentBudget.year) yearValues[date.getMonth()] += Number(tr.querySelector('.distribution-amount').value || 0);
    });
    const linkedComponent = currentBudget.type === 'Investimento' && redistributionNature === 'cost'
      ? capexForCurrent().find(component => component.budgetRowId === row.id) : null;
    if (linkedComponent) {
      const plannedCents = Math.round(yearValues.reduce((sum, value) => sum + value, 0) * 100);
      const economicAdjustmentCents = Array.from({ length: 12 }, (_, month) => getApprovedAdjustment(row.id, month))
        .reduce((sum, value) => sum + Math.round(value * 100), 0);
      const capexCents = Math.round((linkedComponent.approved + linkedComponent.adjustment) * 100);
      if (plannedCents + economicAdjustmentCents !== capexCents) {
        $('#dist-total').setCustomValidity('Per questa voce il totale annuo del budget deve coincidere con il CAPEX aggiornato della tabella 4.');
        $('#dist-total').reportValidity();
        return;
      }
    }
    row.values = yearValues.map(value => Math.round(value * 100) / 100);
    persist(); renderAnalysis(); closeRedistribution(); toast('Importo redistribuito e piano mensile aggiornato');
  }

  $('#budget-list').addEventListener('click', event => {
    const editBudget = event.target.closest('[data-edit-budget]');
    const editChild = event.target.closest('[data-edit-child]');
    const openBudget = event.target.closest('[data-open-budget]');
    const openChild = event.target.closest('[data-open-child]');
    if (editBudget) openEdit('budget', editBudget.dataset.editBudget);
    if (editChild) { const [b,c] = editChild.dataset.editChild.split('|'); openEdit('child',b,c); }
    if (openBudget) openAnalysis(openBudget.dataset.openBudget);
    if (openChild) { const [b,c] = openChild.dataset.openChild.split('|'); openAnalysis(b,c); }
  });
  $('#apply-filters').addEventListener('click', () => { renderBudgets(); toast('Filtri applicati'); });
  $('#create-budget').addEventListener('click', () => openEdit('new'));
  $('#back-management').addEventListener('click', () => showPage('management'));
  $('#save-analysis').addEventListener('click', () => { persist(); toast('Analisi salvata nel mockup'); });
  $('#analysis-type').addEventListener('change', event => {
    const next = budgets.find(budget => budget.type === event.target.value);
    if (next) openAnalysis(next.id);
    else { event.target.value = currentBudget.type; toast('Nessun budget di questo tipo disponibile'); }
  });
  $('#analysis-budget-field').addEventListener('change', event => openAnalysis(event.target.value));
  $('#level-table').addEventListener('change', event => {
    const input = event.target.closest('[data-level-source]');
    if (!input || currentBudget.type !== 'Investimento') return;
    const level = currentBudget.children.find(child => child.id === input.dataset.levelSource);
    if (!level) return;
    level.fundingSource = input.value.trim() || 'Da definire';
    input.value = level.fundingSource;
    persist();
    toast('Fonte di finanziamento salvata in SQLite');
  });

  $$('[data-nature-tab]').forEach(button => button.addEventListener('click', () => { currentNature = button.dataset.natureTab; renderMonthly(); }));
  $('#monthly-table').addEventListener('click', event => {
    const adjustment = event.target.closest('[data-adjust-row]');
    const distribution = event.target.closest('[data-distribute-row]');
    if (adjustment) openAdjustments(adjustment.dataset.adjustRow);
    if (distribution) openRedistribution(distribution.dataset.distributeRow);
  });
  $('#open-adjustments').addEventListener('click', () => openAdjustments());
  $('#capex-adjustment').addEventListener('click', () => openAdjustments(capexForCurrent()[0]?.id, 'capex'));
  $('#close-adjustments').addEventListener('click', closeAdjustments);
  $('#adjustment-drawer').addEventListener('click', event => { if (event.target.id === 'adjustment-drawer') closeAdjustments(); });
  $('#adj-scope').addEventListener('change', () => populateAdjustmentRows());
  $('#adj-nature').addEventListener('change', () => populateAdjustmentRows());
  $('#adj-row').addEventListener('change', updateAdjustmentPreview);
  $('#adj-month').addEventListener('change', updateAdjustmentPreview);
  $('#adj-amount').addEventListener('input', updateAdjustmentPreview);
  $('#clear-adjustment').addEventListener('click', () => { $('#adj-amount').value = 0; $('#adj-reason').value = ''; $('#adj-attachment').value = ''; updateAdjustmentPreview(); });
  $('#adjustment-form').addEventListener('submit', event => {
    event.preventDefault();
    const option = $('#adj-row').selectedOptions[0];
    adjustments.unshift({ id:`RET-${String(50 + adjustments.length).padStart(4,'0')}`, scope:$('#adj-scope').value, nature:$('#adj-nature').value, rowId:$('#adj-row').value, rowLabel:option?.textContent || '', month:Number($('#adj-month').value), amount:Number($('#adj-amount').value || 0), reason:$('#adj-reason').value, attachment:$('#adj-attachment').value, status:'Bozza' });
    persist(); renderAdjustments(); renderAnalysis(); toast('Rettifica salvata in bozza');
  });
  $('#adjustment-list').addEventListener('click', event => {
    const button = event.target.closest('[data-send-adjustment]');
    if (!button) return;
    const item = adjustments.find(a => a.id === button.dataset.sendAdjustment); if (item) item.status = 'In approvazione';
    persist(); renderAdjustments(); toast('Rettifica inviata ad approvazione');
  });

  $('#edit-form').addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (editing.type === 'child') {
      const budget = budgets.find(b => b.id === editing.budgetId); const child = budget.children.find(c => c.id === editing.childId);
      Object.assign(child, { code:data.code, name:data.name, state:data.state });
    } else if (editing.type === 'new') {
      const id = `bdg${Date.now()}`;
      budgets.push({ id, year:Number(data.year), name:data.name.toUpperCase(), version:Number(data.version), frequency:data.frequency, revision:Number(data.revision), typology:data.typology, type:data.budgetType, state:data.state, children:[{id:`${id}01`,code:data.budgetType==='Investimento'?'CAP-NEW-01':'NEW-001',name:'Nuovo livello da completare',state:'Bozza',...(data.budgetType==='Investimento'?{fundingSource:'Da definire'}:{})}] });
    } else {
      const budget = budgets.find(b => b.id === editing.budgetId);
      Object.assign(budget, { year:Number(data.year), name:data.name.toUpperCase(), version:Number(data.version), revision:Number(data.revision), frequency:data.frequency, typology:data.typology, type:data.budgetType, state:data.state });
    }
    ensureFundingSources();
    persist(); renderBudgets(); closeModal(); toast('Modifiche salvate');
  });
  $('#close-modal').addEventListener('click', closeModal);
  $('#cancel-modal').addEventListener('click', closeModal);
  $('#edit-modal').addEventListener('click', event => { if (event.target.id === 'edit-modal') closeModal(); });
  ['dist-total','dist-duration','dist-periodicity','dist-start'].forEach(id => $(`#${id}`).addEventListener('change', () => { $('#dist-total').setCustomValidity(''); renderDistributionSchedule(); }));
  $('#dist-type').addEventListener('change', event => { redistributionNature = event.target.value; });
  $('#distribution-rows').addEventListener('input', event => { if (event.target.classList.contains('distribution-amount')) updateDistributionSummary(); });
  $('#confirm-distribution').addEventListener('click', applyDistribution);
  $('#close-redistribution').addEventListener('click', closeRedistribution);
  $('#redistribution-modal').addEventListener('click', event => { if (event.target.id === 'redistribution-modal') closeRedistribution(); });

  $('#new-voice').addEventListener('click', openVoiceModal);
  $('#voice-form').addEventListener('submit', addBudgetVoice);
  $('#voice-nature').addEventListener('change', updateVoiceAccounts);
  ['voice-total', 'voice-frequency', 'voice-start-month'].forEach(id =>
    $(`#${id}`).addEventListener('input', updateVoicePreview));
  $('#voice-description').addEventListener('input', () => $('#voice-description').setCustomValidity(''));
  $('#voice-account').addEventListener('input', () => $('#voice-account').setCustomValidity(''));
  $('#close-voice-modal').addEventListener('click', closeVoiceModal);
  $('#cancel-voice-modal').addEventListener('click', closeVoiceModal);
  $('#voice-modal').addEventListener('click', event => { if (event.target.id === 'voice-modal') closeVoiceModal(); });
  $('#new-component').addEventListener('click', () => openComponentModal());
  $('#capex-table').addEventListener('click', event => {
    const payment = event.target.closest('[data-edit-payment]');
    if (payment) {
      const [componentId, month] = payment.dataset.editPayment.split('|');
      openComponentModal(componentId);
      $(`#payment-${month}`)?.focus();
      return;
    }
    const button = event.target.closest('[data-edit-component]');
    if (button) openComponentModal(button.dataset.editComponent);
  });
  $('#component-form').addEventListener('submit', saveInvestmentComponent);
  $('#component-description').addEventListener('input', () => $('#component-description').setCustomValidity(''));
  $('#component-account').addEventListener('input', () => $('#component-account').setCustomValidity(''));
  $('#component-amount').addEventListener('input', updateComponentPreview);
  $('#component-payment-fields').addEventListener('input', event => { if (event.target.matches('[data-payment-month]')) updateComponentPreview(); });
  $('#close-component-modal').addEventListener('click', closeComponentModal);
  $('#cancel-component-modal').addEventListener('click', closeComponentModal);
  $('#component-modal').addEventListener('click', event => { if (event.target.id === 'component-modal') closeComponentModal(); });
  $('#submit-capex').addEventListener('click', () => { capexForCurrent().forEach(c => { if (c.state === 'Pianificato') c.state = 'In approvazione'; }); persist(); renderCapex(); toast('Commessa CAPEX inviata ad approvazione'); });

  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); closeVoiceModal(); closeComponentModal(); closeAdjustments(); closeRedistribution(); } });
  renderBudgets();
  hydrateFromServer();
})();
