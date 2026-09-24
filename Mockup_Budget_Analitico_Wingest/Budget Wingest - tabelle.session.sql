SELECT
    b.fiscal_year AS anno,
    b.name AS budget,
    b.budget_type AS tipo,
    bl.code AS codice_livello,
    bl.name AS livello
FROM budget b
JOIN budget_level bl ON bl.budget_id = b.id
ORDER BY b.name, bl.sort_order;