-- 1. Budget e livelli visibili nella prima pagina
SELECT
    b.fiscal_year AS anno,
    b.name AS budget,
    b.budget_type AS tipo,
    b.state AS stato_budget,
    bl.code AS codice_livello,
    bl.name AS livello,
    bl.state AS stato_livello
FROM budget b
JOIN budget_level bl ON bl.budget_id = b.id
ORDER BY b.id, bl.sort_order;

-- 2. Prima tabella dell'analisi: ricavi e costi separati per livello
SELECT
    budget_name,
    level_code,
    level_name,
    funding_source AS fonte_finanziamento,
    revenue_cents / 100.0 AS totale_ricavi,
    cost_cents / 100.0 AS totale_costi
FROM v_budget_level_summary
ORDER BY budget_id, budget_level_id;

-- 3. Seconda tabella: voci e sottoconti
SELECT
    level_code,
    level_name,
    voice,
    account_code,
    nature,
    base_amount_cents / 100.0 AS budget_base,
    approved_adjustment_cents / 100.0 AS rettifiche_approvate,
    updated_amount_cents / 100.0 AS budget_aggiornato
FROM v_budget_item_totals
ORDER BY level_code, nature, account_code;

-- 4. Piano mensile di una voce
SELECT
    bl.code AS livello,
    bi.voice,
    a.code AS sottoconto,
    bpv.period_date AS mese,
    bpv.base_amount_cents / 100.0 AS importo
FROM budget_period_value bpv
JOIN budget_item bi ON bi.id = bpv.budget_item_id
JOIN budget_level bl ON bl.id = bi.budget_level_id
JOIN account a ON a.id = bi.account_id
WHERE bl.code = 'GRA-001'
ORDER BY bi.id, bpv.period_date;

-- 5. Rettifiche con stato e destinazione
SELECT
    ad.id,
    COALESCE(bl.code, cp.code) AS destinazione,
    COALESCE(bi.voice, cc.description) AS voce_o_componente,
    ad.period_date,
    ad.amount_cents / 100.0 AS variazione,
    ad.reason,
    ad.state
FROM adjustment ad
LEFT JOIN budget_item bi ON bi.id = ad.budget_item_id
LEFT JOIN budget_level bl ON bl.id = bi.budget_level_id
LEFT JOIN capex_component cc ON cc.id = ad.capex_component_id
LEFT JOIN capex_project cp ON cp.id = cc.capex_project_id
ORDER BY ad.created_at DESC;

-- 6. Analisi CAPEX della commessa DEPURATORE
SELECT
    project_code,
    component,
    funding_source,
    useful_life_years,
    state,
    approved_amount_cents / 100.0 AS capex_approvato,
    approved_adjustment_cents / 100.0 AS rettifiche,
    updated_capex_cents / 100.0 AS capex_aggiornato,
    scheduled_payment_cents / 100.0 AS pagamenti_pianificati,
    depreciation_year_cents / 100.0 AS ammortamento_anno
FROM v_capex_component_summary
ORDER BY project_code, component_id;

-- 7. Totale per commessa CAPEX
SELECT
    project_code,
    approved_capex_cents / 100.0 AS capex_approvato,
    approved_adjustment_cents / 100.0 AS rettifiche,
    updated_capex_cents / 100.0 AS capex_aggiornato,
    scheduled_payment_cents / 100.0 AS pagamenti_pianificati,
    depreciation_year_cents / 100.0 AS ammortamento_anno
FROM v_capex_project_summary
ORDER BY project_code;

-- 8. Voce del budget di investimento e relativo dettaglio CAPEX
-- L'importo della componente descrive la stessa voce: non sommare i due totali.
SELECT
    cp.code AS commessa,
    bi.voice AS voce_budget,
    a.code AS sottoconto,
    cc.category AS categoria,
    cc.funding_source AS fonte_finanziamento,
    cc.useful_life_years AS vita_utile_anni,
    totals.updated_amount_cents / 100.0 AS budget_voce_euro,
    capex.updated_capex_cents / 100.0 AS capex_aggiornato_euro
FROM capex_component cc
JOIN capex_project cp ON cp.id = cc.capex_project_id
JOIN budget_item bi ON bi.id = cc.budget_item_id
JOIN account a ON a.id = bi.account_id
JOIN v_budget_item_totals totals ON totals.budget_item_id = bi.id
JOIN v_capex_component_summary capex ON capex.component_id = cc.id
ORDER BY cp.code, bi.voice;

-- 9. Ultime voci create o presenti nell'analisi, con importi ricalcolati
SELECT
    b.name AS budget,
    bl.code AS livello,
    bi.voice AS voce,
    a.code AS sottoconto,
    bi.nature AS tipo,
    totals.updated_amount_cents / 100.0 AS totale_euro
FROM budget_item bi
JOIN budget_level bl ON bl.id = bi.budget_level_id
JOIN budget b ON b.id = bl.budget_id
JOIN account a ON a.id = bi.account_id
JOIN v_budget_item_totals totals ON totals.budget_item_id = bi.id
ORDER BY bi.id DESC
LIMIT 10;
