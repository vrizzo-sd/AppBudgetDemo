"""Persistent, invented aggregates simulating the ERP input for every budget."""
import random
import re


def budget_family(budget):
    return (str(budget["name"]).strip().upper(), budget["year"],
            str(budget.get("associatedStructure") or "").strip().upper(), budget["type"])


def actual_keys(state):
    keys = set()
    for budget in state.get("budgets", []):
        family = budget_family(budget)
        plans = [budget.get("planning", {})] + [revision["planning"] for revision in budget.get("revisions", [])]
        for planning in plans:
            rows = planning.get("level1" if planning.get("mode") == "single-level" else "level2", [])
            for row in rows:
                code = re.sub(r"[^a-z0-9]", "", str(row["code"]).lower())
                last_year = max([budget["year"], *map(int, row.get("yearMonths", {}))]) if budget["type"] == "Investimento" else budget["year"]
                for year in range(budget["year"], last_year + 1):
                    for month in range(1, 13):
                        keys.add((*family, code, year, month))
    return keys


def seed_actuals(connection, state):
    """Insert missing periods only; preserve all already imported amounts."""
    existing = {tuple(row) for row in connection.execute("SELECT budget_name, budget_year, structure_key, budget_type, row_code, period_year, period_month FROM budget_actual")}
    missing = actual_keys(state) - existing
    rng = random.SystemRandom()
    connection.executemany(
        """INSERT INTO budget_actual
           (budget_name, budget_year, structure_key, budget_type, row_code, period_year, period_month, actual_amount_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        [(*key, rng.randint(50_000, 2_500_000)) for key in sorted(missing)],
    )
    return len(missing)


def read_actuals(connection, budget):
    records = connection.execute(
        """SELECT row_code, period_year, period_month, actual_amount_cents
           FROM budget_actual
           WHERE budget_name = ? AND budget_year = ? AND structure_key = ? AND budget_type = ?
           ORDER BY row_code, period_year, period_month""", budget_family(budget),
    ).fetchall()
    series = {}
    for code, year, month, amount in records:
        row = series.setdefault((code, year), {"code": code, "year": year, "months": [None] * 12})
        row["months"][month - 1] = amount / 100
    return list(series.values())
