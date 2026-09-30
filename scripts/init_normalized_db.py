from __future__ import annotations

import argparse
import json
import sqlite3
import tempfile
from contextlib import closing
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "data" / "budget_mockup.db"
DEFAULT_TARGET = ROOT / "data" / "budget_wingest.db"
SCHEMA = ROOT / "schema_normalizzato.sql"
LEGACY_PAYMENT_MONTHS = (3, 6, 9, 11)
LEGACY_CAPEX_ROWS = {f"cp{number}": f"ic{number}" for number in range(1, 7)}


def cents(value: object) -> int:
    return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def normalize_code(value: object) -> str:
    return "".join(character.lower() for character in str(value or "") if character.isalnum())


def depreciation_cents(component: dict, year: int) -> int:
    service_date = component.get("inServiceDate")
    if not service_date:
        return cents(component.get("depreciation")) if year == component["budgetYear"] else 0
    start = date.fromisoformat(service_date)
    months = int(component["life"]) * 12
    amount = cents(component.get("approved")) + cents(component.get("adjustment"))

    def rounded_share(months_elapsed: int) -> int:
        return (2 * months_elapsed * amount + months) // (2 * months)

    total = 0
    for month in range(1, 13):
        offset = (year - start.year) * 12 + month - start.month
        if 0 <= offset < months:
            total += rounded_share(offset + 1) - rounded_share(offset)
    return total


def read_mockup_state(source: Path) -> dict:
    if not source.is_file():
        raise FileNotFoundError(f"Database sorgente non trovato: {source}")
    with closing(sqlite3.connect(source)) as connection:
        row = connection.execute("SELECT payload_json FROM mockup_state WHERE id = 1").fetchone()
    if row is None:
        raise RuntimeError("Il database sorgente non contiene lo stato del mockup")
    return json.loads(row[0])


def insert_budget_structure(connection: sqlite3.Connection, state: dict) -> tuple[dict[str, int], dict[str, int]]:
    budget_by_source: dict[str, int] = {}
    level_by_code: dict[str, int] = {}
    component_sources: dict[str, set[str]] = {}
    for component in state.get("capexComponents", []):
        source = (component.get("source") or "").strip()
        if source:
            component_sources.setdefault(normalize_code(component.get("project")), set()).add(source)

    for budget in state.get("budgets", []):
        cursor = connection.execute(
            """
            INSERT INTO budget(
                source_key, fiscal_year, name, version_no, revision_no,
                frequency, structure_type, budget_type, state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                budget["id"], budget["year"], budget["name"], budget.get("version", 1),
                budget.get("revision", 0), budget.get("frequency", "Annuale"),
                budget.get("associatedStructure", ""), budget.get("type", "Ordinario"),
                budget.get("state", "Bozza"),
            ),
        )
        budget_id = cursor.lastrowid
        budget_by_source[budget["id"]] = budget_id

        for sort_order, level in enumerate(budget.get("children", []), start=1):
            funding_source = None
            if budget.get("type") == "Investimento":
                known_sources = component_sources.get(normalize_code(level["code"]), set())
                funding_source = level.get("fundingSource") or (
                    next(iter(known_sources)) if len(known_sources) == 1
                    else "Fonti miste" if known_sources else "Da definire"
                )
            level_cursor = connection.execute(
                """
                INSERT INTO budget_level(budget_id, source_key, code, name, funding_source, state, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    budget_id, level["id"], level["code"], level["name"],
                    funding_source,
                    level.get("state", "Bozza"), sort_order,
                ),
            )
            level_by_code[normalize_code(level["code"])] = level_cursor.lastrowid

    return budget_by_source, level_by_code


def fiscal_year_for_level(connection: sqlite3.Connection, level_id: int) -> int:
    row = connection.execute(
        """
        SELECT b.fiscal_year
        FROM budget_level bl
        JOIN budget b ON b.id = bl.budget_id
        WHERE bl.id = ?
        """,
        (level_id,),
    ).fetchone()
    return int(row[0])


def insert_economic_rows(connection: sqlite3.Connection, state: dict, level_by_code: dict[str, int]) -> dict[str, int]:
    item_by_source: dict[str, int] = {}
    account_by_code: dict[str, int] = {}

    sources = (state.get("ordinaryRows", {}), state.get("investmentRows", {}))
    for source in sources:
        for source_nature, nature in (("cost", "Costo"), ("revenue", "Ricavo")):
            for row in source.get(source_nature, []):
                level_id = level_by_code.get(normalize_code(row.get("code")))
                if level_id is None:
                    continue

                account_code = str(row.get("account") or "DA-DEFINIRE")
                account_id = account_by_code.get(account_code)
                if account_id is None:
                    connection.execute(
                        "INSERT OR IGNORE INTO account(code, description, nature) VALUES (?, ?, ?)",
                        (account_code, row.get("voice") or row.get("description") or account_code, nature),
                    )
                    account_id = connection.execute("SELECT id FROM account WHERE code = ?", (account_code,)).fetchone()[0]
                    account_by_code[account_code] = account_id

                item_cursor = connection.execute(
                    """
                    INSERT INTO budget_item(source_key, budget_level_id, account_id, voice, nature, duration_months)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (row["id"], level_id, account_id, row.get("voice") or row.get("description"), nature, len(row.get("values", [])) or 12),
                )
                item_id = item_cursor.lastrowid
                item_by_source[row["id"]] = item_id
                fiscal_year = fiscal_year_for_level(connection, level_id)

                for month, amount in enumerate(row.get("values", []), start=1):
                    connection.execute(
                        "INSERT INTO budget_period_value(budget_item_id, period_date, base_amount_cents) VALUES (?, ?, ?)",
                        (item_id, date(fiscal_year, month, 1).isoformat(), cents(amount)),
                    )

    return item_by_source


def insert_capex(connection: sqlite3.Connection, state: dict, level_by_code: dict[str, int], item_by_source: dict[str, int]) -> dict[str, int]:
    component_by_source: dict[str, int] = {}
    project_by_code: dict[str, tuple[int, int]] = {}

    for budget in state.get("budgets", []):
        if budget.get("type") != "Investimento":
            continue
        for level in budget.get("children", []):
            level_id = level_by_code.get(normalize_code(level.get("code")))
            if level_id is None:
                continue
            code = normalize_code(level["code"])
            existing = project_by_code.get(code)
            if existing is None:
                cursor = connection.execute(
                    """
                    INSERT INTO capex_project(source_key, budget_level_id, code, description, state)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (level["id"], level_id, level["code"], level["name"], level.get("state", "Bozza")),
                )
                project_by_code[code] = (cursor.lastrowid, int(budget["year"]))

    for component in state.get("capexComponents", []):
        payments = component.get("payments", [])
        is_empty_placeholder = (
            component.get("component") == "Nuovo componente"
            and cents(component.get("approved")) == 0
            and cents(component.get("adjustment")) == 0
            and sum(cents(value) for value in payments) == 0
        )
        if is_empty_placeholder:
            continue

        project = project_by_code.get(normalize_code(component.get("project")))
        if project is None:
            continue
        project_id, fiscal_year = project
        component_for_depreciation = {**component, "budgetYear": fiscal_year}
        mode = component.get("paymentMode") or "manuale"
        cursor = connection.execute(
            """
            INSERT INTO capex_component(
                source_key, capex_project_id, budget_item_id, description, category, funding_source,
                useful_life_years, purchase_date, in_service_date, payment_mode,
                first_due_date, installment_count, interval_months, annual_interest_rate,
                state, approved_amount_cents, depreciation_year_cents
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                component["id"], project_id,
                item_by_source.get(component.get("budgetRowId") or LEGACY_CAPEX_ROWS.get(component["id"])),
                component["component"], component.get("category", "Da definire"),
                component.get("source", "Da definire"), int(component.get("life", 1)),
                component.get("purchaseDate"), component.get("inServiceDate"), mode,
                component.get("firstDueDate"), component.get("installments"),
                component.get("intervalMonths"), float(component.get("annualRate") or 0),
                component.get("state", "Pianificato"), cents(component.get("approved")),
                depreciation_cents(component_for_depreciation, fiscal_year),
            ),
        )
        component_id = cursor.lastrowid
        component_by_source[component["id"]] = component_id

        schedule = component.get("paymentSchedule") or []
        if schedule:
            principal_total = sum(cents(payment["principal"]) for payment in schedule)
            expected_total = cents(component.get("approved")) + cents(component.get("adjustment"))
            if principal_total != expected_total:
                raise ValueError(f"Capitale rate non coerente per {component['id']}")
            for payment in schedule:
                principal = cents(payment["principal"])
                interest = cents(payment.get("interest"))
                connection.execute(
                    """
                    INSERT INTO capex_payment(
                        capex_component_id, due_date, amount_cents, principal_cents, interest_cents
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (component_id, date.fromisoformat(payment["date"]).isoformat(),
                     principal + interest, principal, interest),
                )
        elif len(payments) == 4:
            monthly_payments = [0] * 12
            for month, amount in zip(LEGACY_PAYMENT_MONTHS, payments):
                monthly_payments[month - 1] = amount
        elif len(payments) == 12:
            monthly_payments = payments
        else:
            raise ValueError(f"Piano pagamenti non valido per {component['id']}: attesi 12 mesi")

        if not schedule:
            for month, amount in enumerate(monthly_payments, start=1):
                connection.execute(
                    """
                    INSERT INTO capex_payment(
                        capex_component_id, due_date, amount_cents, principal_cents, interest_cents
                    ) VALUES (?, ?, ?, ?, 0)
                    """,
                    (component_id, date(fiscal_year, month, 1).isoformat(), cents(amount), cents(amount)),
                )

        if component.get("inServiceDate"):
            first_year = date.fromisoformat(component["inServiceDate"]).year
            for year in range(first_year, first_year + int(component["life"]) + 1):
                value = depreciation_cents(component_for_depreciation, year)
                if value:
                    connection.execute(
                        "INSERT INTO capex_depreciation(capex_component_id, fiscal_year, amount_cents) VALUES (?, ?, ?)",
                        (component_id, year, value),
                    )
        else:
            connection.execute(
                "INSERT INTO capex_depreciation(capex_component_id, fiscal_year, amount_cents) VALUES (?, ?, ?)",
                (component_id, fiscal_year, cents(component.get("depreciation"))),
            )

    return component_by_source


def insert_adjustments(
    connection: sqlite3.Connection,
    state: dict,
    item_by_source: dict[str, int],
    component_by_source: dict[str, int],
) -> None:
    for adjustment in state.get("adjustments", []):
        item_id = item_by_source.get(adjustment.get("rowId")) if adjustment.get("scope") == "economic" else None
        component_id = component_by_source.get(adjustment.get("rowId")) if adjustment.get("scope") == "capex" else None
        if item_id is None and component_id is None:
            continue

        if item_id is not None:
            fiscal_year = connection.execute(
                """
                SELECT b.fiscal_year
                FROM budget_item bi
                JOIN budget_level bl ON bl.id = bi.budget_level_id
                JOIN budget b ON b.id = bl.budget_id
                WHERE bi.id = ?
                """,
                (item_id,),
            ).fetchone()[0]
        else:
            fiscal_year = connection.execute(
                """
                SELECT b.fiscal_year
                FROM capex_component cc
                JOIN capex_project cp ON cp.id = cc.capex_project_id
                JOIN budget_level bl ON bl.id = cp.budget_level_id
                JOIN budget b ON b.id = bl.budget_id
                WHERE cc.id = ?
                """,
                (component_id,),
            ).fetchone()[0]

        month = int(adjustment.get("month", 0)) + 1
        period_date = date(int(fiscal_year), max(1, min(12, month)), 1).isoformat()
        connection.execute(
            """
            INSERT INTO adjustment(
                id, budget_item_id, capex_component_id, period_date, amount_cents,
                reason, attachment_ref, state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                adjustment["id"], item_id, component_id, period_date, cents(adjustment.get("amount")),
                adjustment.get("reason") or "Rettifica senza motivazione", adjustment.get("attachment") or None,
                adjustment.get("status", "Bozza"),
            ),
        )

        if adjustment.get("status") != "Bozza":
            connection.execute(
                """
                INSERT INTO approval_event(adjustment_id, step_no, actor, decision, note)
                VALUES (?, 1, 'workflow.demo', ?, 'Stato importato dal mockup')
                """,
                (adjustment["id"], adjustment.get("status")),
            )


def build_database(source: Path, target: Path, replace: bool) -> None:
    if target.exists() and not replace:
        raise FileExistsError(f"Il database esiste già: {target}. Usa --replace per rigenerarlo.")

    state = read_mockup_state(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = tempfile.NamedTemporaryFile(prefix="budget_wingest_", suffix=".db", dir=target.parent, delete=False)
    temporary_path = Path(temporary.name)
    temporary.close()

    try:
        with closing(sqlite3.connect(temporary_path)) as connection:
            with connection:
                connection.execute("PRAGMA foreign_keys = ON")
                connection.executescript(SCHEMA.read_text(encoding="utf-8"))
                _, level_by_code = insert_budget_structure(connection, state)
                item_by_source = insert_economic_rows(connection, state, level_by_code)
                component_by_source = insert_capex(connection, state, level_by_code, item_by_source)
                insert_adjustments(connection, state, item_by_source, component_by_source)
                connection.execute("INSERT OR REPLACE INTO app_metadata(key, value) VALUES ('generated_at', CURRENT_TIMESTAMP)")

                foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
                integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
                if foreign_key_errors or integrity != "ok":
                    raise RuntimeError(f"Controllo database fallito: integrity={integrity}, foreign_keys={foreign_key_errors}")

        # SQLite backup aggiorna lo stesso file: funziona anche se SQLTools ha già
        # aperto la connessione, mentre la sostituzione del file fallisce su Windows.
        with closing(sqlite3.connect(temporary_path)) as source_connection:
            with closing(sqlite3.connect(target)) as target_connection:
                source_connection.backup(target_connection)
        temporary_path.unlink(missing_ok=True)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def database_counts(target: Path) -> dict[str, int]:
    tables = ("budget", "budget_level", "account", "budget_item", "budget_period_value", "adjustment", "approval_event", "capex_project", "capex_component", "capex_payment", "capex_depreciation")
    with closing(sqlite3.connect(target)) as connection:
        return {table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in tables}


def main() -> None:
    parser = argparse.ArgumentParser(description="Crea il database normalizzato del mockup Budget Wingest")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()

    build_database(args.source.resolve(), args.target.resolve(), args.replace)
    print(f"Database creato: {args.target.resolve()}")
    for table, count in database_counts(args.target.resolve()).items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
