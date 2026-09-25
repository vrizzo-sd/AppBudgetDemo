-- Eseguire UNA SELECT alla volta in SQLTools sulla connessione data/budget_wingest.db.
-- Gli importi del database sono in centesimi; le colonne *_euro sono divise per 100.

-- 1. Gestione budget: intestazioni e righe bianche sottostanti.
SELECT b.fiscal_year AS anno, b.name AS budget, b.budget_type AS tipo,
       b.state AS stato_budget, bl.code AS codice_livello,
       bl.name AS livello, bl.funding_source AS fonte_finanziamento
FROM budget b
JOIN budget_level bl ON bl.budget_id = b.id
ORDER BY b.id, bl.sort_order;

-- 2. Tabella 1: totale ricavi e costi, senza compensarli.
SELECT budget_name, level_code, level_name, funding_source,
       revenue_cents / 100.0 AS ricavi_euro,
       cost_cents / 100.0 AS costi_euro
FROM v_budget_level_summary
ORDER BY budget_id, budget_level_id;

-- 3. Tabella 2: voce, sottoconto, budget e rettifiche approvate.
SELECT level_code, level_name, voice, account_code, nature,
       base_amount_cents / 100.0 AS budget_base_euro,
       approved_adjustment_cents / 100.0 AS rettifiche_euro,
       updated_amount_cents / 100.0 AS budget_aggiornato_euro
FROM v_budget_item_totals
ORDER BY level_code, nature, account_code, voice;

-- 4. Tabella 3: valori mensili di GRA-001.
SELECT bl.code AS livello, bi.voice AS voce, a.code AS sottoconto,
       bpv.period_date AS mese, bpv.base_amount_cents / 100.0 AS importo_euro
FROM budget_period_value bpv
JOIN budget_item bi ON bi.id = bpv.budget_item_id
JOIN budget_level bl ON bl.id = bi.budget_level_id
JOIN account a ON a.id = bi.account_id
WHERE bl.code = 'GRA-001'
ORDER BY bi.id, bpv.period_date;

-- 5. Rettifiche: solo lo stato Approvata entra nei totali ufficiali.
SELECT ad.id, COALESCE(bl.code, cp.code) AS destinazione,
       COALESCE(bi.voice, cc.description) AS voce,
       ad.period_date, ad.amount_cents / 100.0 AS variazione_euro,
       ad.reason, ad.state
FROM adjustment ad
LEFT JOIN budget_item bi ON bi.id = ad.budget_item_id
LEFT JOIN budget_level bl ON bl.id = bi.budget_level_id
LEFT JOIN capex_component cc ON cc.id = ad.capex_component_id
LEFT JOIN capex_project cp ON cp.id = cc.capex_project_id
ORDER BY ad.created_at DESC;

-- 6. CAPEX: capitale pianificato, interessi e uscite di tutto il piano.
SELECT project_code, component, funding_source, useful_life_years,
       approved_amount_cents / 100.0 AS capex_iniziale_euro,
       approved_adjustment_cents / 100.0 AS rettifiche_euro,
       updated_capex_cents / 100.0 AS capex_aggiornato_euro,
       scheduled_principal_cents / 100.0 AS capitale_rate_euro,
       scheduled_interest_cents / 100.0 AS interessi_euro,
       scheduled_payment_cents / 100.0 AS uscite_totali_euro
FROM v_capex_component_summary
ORDER BY project_code, component_id;

-- 7. Tabella 4: piano annuale, per esempio anno 2027.
SELECT cp.code AS commessa, cc.description AS voce, substr(pay.due_date, 1, 7) AS mese,
       SUM(pay.principal_cents) / 100.0 AS capitale_euro,
       SUM(pay.interest_cents) / 100.0 AS interessi_euro,
       SUM(pay.amount_cents) / 100.0 AS uscita_euro
FROM capex_payment pay
JOIN capex_component cc ON cc.id = pay.capex_component_id
JOIN capex_project cp ON cp.id = cc.capex_project_id
WHERE substr(pay.due_date, 1, 4) = '2027'
GROUP BY cp.code, cc.id, substr(pay.due_date, 1, 7)
ORDER BY cp.code, voce, mese;

-- 8. Quote annue di ammortamento demo: indipendenti dalle rate.
SELECT cp.code AS commessa, cc.description AS voce,
       cc.purchase_date AS data_investimento,
       cc.in_service_date AS entrata_in_funzione,
       d.fiscal_year AS anno,
       d.amount_cents / 100.0 AS ammortamento_euro
FROM capex_depreciation d
JOIN capex_component cc ON cc.id = d.capex_component_id
JOIN capex_project cp ON cp.id = cc.capex_project_id
ORDER BY cp.code, cc.id, d.fiscal_year;

-- 9. Verifica: la differenza deve essere zero per ogni voce CAPEX.
SELECT project_code, component,
       (updated_capex_cents - scheduled_principal_cents) / 100.0
         AS capitale_non_pianificato_euro
FROM v_capex_component_summary
ORDER BY project_code, component_id;
