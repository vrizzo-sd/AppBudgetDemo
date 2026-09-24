CREATE TABLE IF NOT EXISTS mockup_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
