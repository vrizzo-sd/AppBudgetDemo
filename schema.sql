CREATE TABLE IF NOT EXISTS mockup_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Simulated aggregated ERP input, independent of approved budget snapshots.
CREATE TABLE IF NOT EXISTS budget_actual (
    budget_name TEXT NOT NULL,
    budget_year INTEGER NOT NULL CHECK (budget_year BETWEEN 2000 AND 2100),
    structure_key TEXT NOT NULL,
    budget_type TEXT NOT NULL CHECK (budget_type IN ('Ordinario', 'Investimento')),
    row_code TEXT NOT NULL,
    period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
    period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    actual_amount_cents INTEGER NOT NULL CHECK (typeof(actual_amount_cents) = 'integer' AND actual_amount_cents >= 0),
    source TEXT NOT NULL DEFAULT 'ERP_SIMULATO',
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (budget_name, budget_year, structure_key, budget_type, row_code, period_year, period_month)
);
