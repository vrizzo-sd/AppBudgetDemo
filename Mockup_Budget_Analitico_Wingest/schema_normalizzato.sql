PRAGMA foreign_keys = ON;

CREATE TABLE app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE budget (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE,
    fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
    name TEXT NOT NULL,
    version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
    revision_no INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
    frequency TEXT NOT NULL,
    structure_type TEXT NOT NULL,
    budget_type TEXT NOT NULL CHECK (budget_type IN ('Ordinario', 'Investimento')),
    state TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (fiscal_year, name, version_no)
);

CREATE TABLE budget_level (
    id INTEGER PRIMARY KEY,
    budget_id INTEGER NOT NULL REFERENCES budget(id) ON DELETE RESTRICT,
    source_key TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    funding_source TEXT,
    state TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (budget_id, code)
);

CREATE TABLE account (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    nature TEXT NOT NULL CHECK (nature IN ('Costo', 'Ricavo', 'Patrimoniale')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE budget_item (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE,
    budget_level_id INTEGER NOT NULL REFERENCES budget_level(id) ON DELETE RESTRICT,
    account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
    voice TEXT NOT NULL,
    nature TEXT NOT NULL CHECK (nature IN ('Costo', 'Ricavo')),
    duration_months INTEGER NOT NULL DEFAULT 12 CHECK (duration_months > 0),
    UNIQUE (budget_level_id, account_id, voice, nature)
);

CREATE TABLE budget_period_value (
    id INTEGER PRIMARY KEY,
    budget_item_id INTEGER NOT NULL REFERENCES budget_item(id) ON DELETE CASCADE,
    period_date TEXT NOT NULL CHECK (period_date GLOB '????-??-??'),
    base_amount_cents INTEGER NOT NULL,
    UNIQUE (budget_item_id, period_date)
);

CREATE TABLE capex_project (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE,
    budget_level_id INTEGER NOT NULL UNIQUE REFERENCES budget_level(id) ON DELETE RESTRICT,
    code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    state TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT
);

CREATE TABLE capex_component (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE,
    capex_project_id INTEGER NOT NULL REFERENCES capex_project(id) ON DELETE RESTRICT,
    budget_item_id INTEGER UNIQUE REFERENCES budget_item(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    funding_source TEXT NOT NULL,
    useful_life_years INTEGER NOT NULL CHECK (useful_life_years > 0),
    state TEXT NOT NULL,
    approved_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (approved_amount_cents >= 0),
    depreciation_year_cents INTEGER NOT NULL DEFAULT 0 CHECK (depreciation_year_cents >= 0)
);

CREATE TABLE capex_payment (
    id INTEGER PRIMARY KEY,
    capex_component_id INTEGER NOT NULL REFERENCES capex_component(id) ON DELETE CASCADE,
    due_date TEXT NOT NULL CHECK (due_date GLOB '????-??-??'),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    payment_state TEXT NOT NULL DEFAULT 'Pianificato',
    UNIQUE (capex_component_id, due_date)
);

CREATE TABLE adjustment (
    id TEXT PRIMARY KEY,
    budget_item_id INTEGER REFERENCES budget_item(id) ON DELETE RESTRICT,
    capex_component_id INTEGER REFERENCES capex_component(id) ON DELETE RESTRICT,
    period_date TEXT,
    amount_cents INTEGER NOT NULL,
    reason TEXT NOT NULL,
    attachment_ref TEXT,
    state TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'utente.demo',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((budget_item_id IS NOT NULL) <> (capex_component_id IS NOT NULL))
);

CREATE TABLE approval_event (
    id INTEGER PRIMARY KEY,
    adjustment_id TEXT NOT NULL REFERENCES adjustment(id) ON DELETE CASCADE,
    step_no INTEGER NOT NULL CHECK (step_no > 0),
    actor TEXT NOT NULL,
    decision TEXT NOT NULL,
    note TEXT,
    decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (adjustment_id, step_no)
);

CREATE INDEX idx_budget_level_budget ON budget_level(budget_id);
CREATE INDEX idx_budget_item_level ON budget_item(budget_level_id);
CREATE INDEX idx_budget_value_period ON budget_period_value(period_date);
CREATE INDEX idx_adjustment_item ON adjustment(budget_item_id);
CREATE INDEX idx_adjustment_capex ON adjustment(capex_component_id);
CREATE INDEX idx_capex_component_project ON capex_component(capex_project_id);
CREATE INDEX idx_capex_payment_due_date ON capex_payment(due_date);

CREATE VIEW v_budget_item_totals AS
SELECT
    bi.id AS budget_item_id,
    bi.source_key,
    bi.budget_level_id,
    bl.code AS level_code,
    bl.name AS level_name,
    bi.voice,
    a.code AS account_code,
    bi.nature,
    COALESCE(SUM(bpv.base_amount_cents), 0) AS base_amount_cents,
    COALESCE((
        SELECT SUM(ad.amount_cents)
        FROM adjustment ad
        WHERE ad.budget_item_id = bi.id
          AND ad.state = 'Approvata'
    ), 0) AS approved_adjustment_cents,
    COALESCE(SUM(bpv.base_amount_cents), 0) + COALESCE((
        SELECT SUM(ad.amount_cents)
        FROM adjustment ad
        WHERE ad.budget_item_id = bi.id
          AND ad.state = 'Approvata'
    ), 0) AS updated_amount_cents
FROM budget_item bi
JOIN budget_level bl ON bl.id = bi.budget_level_id
JOIN account a ON a.id = bi.account_id
LEFT JOIN budget_period_value bpv ON bpv.budget_item_id = bi.id
GROUP BY bi.id, bi.budget_level_id, bl.code, bl.name, bi.voice, a.code, bi.nature;

CREATE VIEW v_budget_level_summary AS
SELECT
    b.id AS budget_id,
    b.source_key AS budget_source_key,
    b.name AS budget_name,
    b.fiscal_year,
    bl.id AS budget_level_id,
    bl.source_key,
    bl.code AS level_code,
    bl.name AS level_name,
    bl.funding_source,
    COALESCE(SUM(CASE WHEN totals.nature = 'Ricavo' THEN totals.updated_amount_cents ELSE 0 END), 0) AS revenue_cents,
    COALESCE(SUM(CASE WHEN totals.nature = 'Costo' THEN totals.updated_amount_cents ELSE 0 END), 0) AS cost_cents
FROM budget b
JOIN budget_level bl ON bl.budget_id = b.id
LEFT JOIN v_budget_item_totals totals ON totals.budget_level_id = bl.id
GROUP BY b.id, b.source_key, b.name, b.fiscal_year, bl.id, bl.source_key, bl.code, bl.name, bl.funding_source;

CREATE VIEW v_capex_component_summary AS
SELECT
    cp.code AS project_code,
    cc.id AS component_id,
    cc.budget_item_id,
    cc.description AS component,
    cc.category,
    cc.funding_source,
    cc.useful_life_years,
    cc.state,
    cc.approved_amount_cents,
    COALESCE((
        SELECT SUM(ad.amount_cents)
        FROM adjustment ad
        WHERE ad.capex_component_id = cc.id
          AND ad.state = 'Approvata'
    ), 0) AS approved_adjustment_cents,
    cc.approved_amount_cents + COALESCE((
        SELECT SUM(ad.amount_cents)
        FROM adjustment ad
        WHERE ad.capex_component_id = cc.id
          AND ad.state = 'Approvata'
    ), 0) AS updated_capex_cents,
    COALESCE((SELECT SUM(pay.amount_cents) FROM capex_payment pay WHERE pay.capex_component_id = cc.id), 0) AS scheduled_payment_cents,
    cc.depreciation_year_cents
FROM capex_component cc
JOIN capex_project cp ON cp.id = cc.capex_project_id;

CREATE VIEW v_capex_project_summary AS
SELECT
    project_code,
    SUM(approved_amount_cents) AS approved_capex_cents,
    SUM(approved_adjustment_cents) AS approved_adjustment_cents,
    SUM(updated_capex_cents) AS updated_capex_cents,
    SUM(scheduled_payment_cents) AS scheduled_payment_cents,
    SUM(depreciation_year_cents) AS depreciation_year_cents
FROM v_capex_component_summary
GROUP BY project_code;

INSERT INTO app_metadata(key, value) VALUES
    ('schema_version', '1'),
    ('data_classification', 'Dati demo non contabili'),
    ('amount_storage', 'centesimi interi'),
    ('source', 'budget_mockup.db/mockup_state');
