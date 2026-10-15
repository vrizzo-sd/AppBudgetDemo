"""Validation of the local demo's persisted budget workflow (no ERP authorization)."""
from copy import deepcopy
from decimal import Decimal
import math


def cents(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Importo non numerico")
    result = Decimal(str(value)) * 100
    if abs(result - result.to_integral_value()) > Decimal("0.000001"):
        raise ValueError("Sono ammessi al massimo due decimali")
    return int(result.to_integral_value())


def rows(planning):
    return planning["level1"] if planning["mode"] == "single-level" else planning["level2"]


def amounts(row):
    return row.get("months", []) + [value for values in row.get("yearMonths", {}).values() for value in values]


def family(budget):
    return (budget["year"], budget["name"].strip().upper(), budget.get("associatedStructure", "").strip().upper(), budget["type"])


def balanced(planning):
    parents = planning["level1"]
    children = rows(planning)
    if not parents or not children:
        raise ValueError("Completa i livelli del budget prima dell'invio")
    if abs(sum(row["totalPercent"] for row in parents) - 100) > .005:
        raise ValueError("Le percentuali di Livello 1 devono totalizzare 100%")
    total = sum(cents(row["budget"]) for row in parents)
    configured = cents(planning.get("totalBudget", total / 100)) or total
    if planning["mode"] != "single-level":
        if abs(sum(row["totalPercent"] for row in children) - 100) > .005:
            raise ValueError("Le percentuali di Livello 2 devono totalizzare 100%")
        for parent in parents:
            group = [row for row in children if row["parentId"] == parent["id"]]
            if not group or abs(sum(row["totalPercent"] for row in group) - parent["totalPercent"]) > .005:
                raise ValueError("I figli devono quadrare con il padre")
    for row in children:
        if row.get("monthlyActive") is False:
            raise ValueError("Completa la pianificazione mensile prima dell'invio")
        actual = sum(cents(value) for value in amounts(row))
        expected = cents(row["budget"]) if planning["mode"] == "single-level" else configured * row["totalPercent"] / 100
        if abs(actual - expected) > .50001:
            raise ValueError("La pianificazione mensile non quadra")


def equivalent(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(equivalent(a[key], b[key]) for key in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(equivalent(x, y) for x, y in zip(a, b))
    if isinstance(a, (float, int)) and isinstance(b, (float, int)) and not isinstance(a, bool) and not isinstance(b, bool):
        return math.isclose(a, b, abs_tol=1e-7, rel_tol=1e-12)
    return a == b


def effective(budget, adjustments):
    planning = deepcopy(budget["planning"])
    planning["budgetYear"] = budget["year"]
    levels = {row["id"]: row for row in rows(planning)}
    changed = False
    for adjustment in adjustments:
        if adjustment.get("scope") != "planning" or adjustment.get("budgetId") != budget["id"] or adjustment["status"] != "Approvata":
            continue
        row = levels[adjustment["rowId"]]
        year = adjustment.get("year", budget["year"])
        values = row["months"] if year == budget["year"] else row.setdefault("yearMonths", {}).setdefault(str(year), [0] * 12)
        values[adjustment["month"]] = (cents(values[adjustment["month"]]) + cents(adjustment["amount"])) / 100
        if values[adjustment["month"]] < 0:
            raise ValueError("Le rettifiche rendono negativo il budget")
        changed = changed or cents(adjustment["amount"]) != 0
    if changed:
        if planning["mode"] == "single-level":
            for row in levels.values():
                row["budget"] = sum(cents(value) for value in amounts(row)) / 100
        else:
            for parent in planning["level1"]:
                parent["budget"] = sum(cents(value) for row in levels.values() if row["parentId"] == parent["id"] for value in row["months"]) / 100
        total = sum(cents(row["budget"]) for row in planning["level1"]) / 100
        planning["totalBudget"] = total
        for row in planning["level1"]:
            row["totalPercent"] = row["budget"] / total * 100 if total else 0
        if planning["mode"] != "single-level":
            for row in planning["level2"]:
                row["totalPercent"] = sum(cents(value) for value in row["months"]) / 100 / total * 100 if total else 0
    return planning


def validate_state(payload, previous):
    """Reject invalid transitions and attempts to overwrite approved history."""
    for name in ("budgets", "adjustments", "monthlyHistory", "capexComponents"):
        if not isinstance(payload.get(name), list):
            raise ValueError(f"Elenco {name} mancante o non valido")
    if not payload["budgets"]:
        raise ValueError("Deve rimanere almeno un budget")
    for name in ("ordinaryRows", "investmentRows"):
        if not isinstance(payload.get(name), dict):
            raise ValueError(f"Dati {name} non validi")
    budgets = {budget["id"]: budget for budget in payload["budgets"]}
    if len(budgets) != len(payload["budgets"]):
        raise ValueError("Identificativi budget duplicati")
    old_budgets = {budget["id"]: budget for budget in previous.get("budgets", [])}
    requests = {request["id"]: request for request in payload["monthlyHistory"]}
    if len(requests) != len(payload["monthlyHistory"]):
        raise ValueError("Identificativi richiesta duplicati")
    old_requests = {request["id"]: request for request in previous.get("monthlyHistory", [])}
    unique = set()
    official = set()
    transitions = {"Bozza": {"Bozza", "In approvazione"}, "In approvazione": {"In approvazione", "Bozza", "Approvato", "Respinto"}, "Respinto": {"Respinto", "Bozza"}, "Approvato": {"Approvato"}}
    for budget_id, budget in budgets.items():
        if not isinstance(budget["year"], int) or not 2000 <= budget["year"] <= 2100 or not budget["name"].strip():
            raise ValueError("Anno o nome budget non valido")
        if not isinstance(budget["version"], int) or budget["version"] < 1 or budget["type"] not in {"Ordinario", "Investimento"}:
            raise ValueError("Versione o tipo budget non valido")
        identity = (budget["year"], budget["name"].strip().upper(), budget["version"])
        if identity in unique:
            raise ValueError("Anno, nome e versione devono essere univoci")
        unique.add(identity)
        state = budget["workflowState"]
        old = old_budgets.get(budget_id)
        old_state = old.get("workflowState", "Bozza") if old else "Bozza"
        if state not in transitions[old_state] or not old and state != "Bozza":
            raise ValueError("Transizione budget non consentita")
        planning = budget["planning"]
        if planning["mode"] != ("single-level" if budget["type"] == "Investimento" else "two-level"):
            raise ValueError("Struttura del budget non coerente con il tipo")
        all_levels = planning["level1"] + planning["level2"]
        ids = [row["id"] for row in all_levels]
        if len(ids) != len(set(ids)):
            raise ValueError("Identificativi dei livelli duplicati")
        for row in all_levels:
            if not math.isfinite(row["totalPercent"]) or row["totalPercent"] < 0:
                raise ValueError("Percentuale non valida")
            if len(row.get("months", [0] * 12)) != 12 or any(len(values) != 12 for values in row.get("yearMonths", {}).values()):
                raise ValueError("Ogni anno deve contenere dodici mesi")
            if any(cents(value) < 0 for value in amounts(row)) or cents(row.get("budget", 0)) < 0:
                raise ValueError("Il budget non può contenere importi negativi")
        if any(row["parentId"] not in {parent["id"] for parent in planning["level1"]} for row in planning["level2"]):
            raise ValueError("Livello padre non trovato")
        if state in {"In approvazione", "Approvato"}:
            balanced(planning)
        if old_state != "Bozza":
            for field in ("name", "year", "version", "type", "associatedStructure", "frequency", "children", "planning"):
                if not equivalent(old.get(field), budget.get(field)):
                    raise ValueError("Il budget inviato o approvato non è modificabile: ritira la richiesta o crea una nuova versione")
        if old and old_state == "Approvato" and old.get("baseSnapshot") != budget.get("baseSnapshot"):
            raise ValueError("Il budget iniziale approvato non è modificabile")
        old_events = old.get("workflowEvents", []) if old else []
        if budget.get("workflowEvents", [])[:len(old_events)] != old_events:
            raise ValueError("L'iter del budget non può essere modificato")
        if state != old_state:
            events = budget.get("workflowEvents", [])
            if len(events) != len(old_events) + 1 or not events[-1].get("actor") or not events[-1].get("at"):
                raise ValueError("La decisione sul budget deve essere storicizzata")
            if state == "Respinto" and not events[-1].get("note", "").strip():
                raise ValueError("Il rifiuto richiede una motivazione")
        old_revisions = old.get("revisions", []) if old else []
        revisions = budget["revisions"]
        if revisions[:len(old_revisions)] != old_revisions or len(revisions) < len(old_revisions):
            raise ValueError("Le revisioni approvate non possono essere modificate o eliminate")
        initial_approval = state == "Approvato" and old_state == "In approvazione"
        newly_approved = [request for request in requests.values() if request["budgetId"] == budget_id and request["status"] == "Approvata" and old_requests.get(request["id"], {}).get("status") != "Approvata"]
        expected_count = len(old_revisions) + (1 if initial_approval else 0) + len(newly_approved)
        if len(revisions) != expected_count or len(newly_approved) > 1:
            raise ValueError("Ogni approvazione deve produrre una sola revisione")
        if revisions:
            if budget["revision"] != revisions[-1]["number"] or [revision["number"] for revision in revisions] != list(range(len(revisions))):
                raise ValueError("Numerazione revisioni non valida")
            if len(revisions) > len(old_revisions):
                if not equivalent(revisions[-1]["planning"], effective(budget, payload["adjustments"])):
                    raise ValueError("La revisione non corrisponde al budget aggiornato")
                if newly_approved and revisions[-1].get("requestId") != newly_approved[0]["id"]:
                    raise ValueError("La revisione deve indicare la rettifica approvata")
                if initial_approval and budget.get("baseSnapshot") != planning:
                    raise ValueError("La fotografia iniziale non corrisponde al budget approvato")
        elif state == "Approvato":
            raise ValueError("Manca la revisione iniziale")
        if budget["isOfficial"]:
            if state != "Approvato" or family(budget) in official:
                raise ValueError("È consentita una sola versione ufficiale approvata per budget, anno e struttura")
            official.add(family(budget))
            if old and not old.get("isOfficial") and not initial_approval:
                raise ValueError("La versione diventa ufficiale soltanto con l'approvazione")
        if old and old.get("isOfficial") and not budget["isOfficial"]:
            if not any(other["id"] != budget_id and other["isOfficial"] and family(other) == family(budget) for other in budgets.values()):
                raise ValueError("La versione ufficiale può essere sostituita solo da un'altra approvata")
    for budget_id, old in old_budgets.items():
        if budget_id not in budgets and old.get("workflowState", "Bozza") != "Bozza":
            raise ValueError("Solo i budget in bozza possono essere eliminati")
    request_transitions = {"Bozza": {"Bozza", "In approvazione"}, "In approvazione": {"In approvazione", "Bozza", "Approvata", "Respinta"}, "Approvata": {"Approvata"}, "Respinta": {"Respinta"}}
    cells = set()
    for request_id, request in requests.items():
        budget = budgets[request["budgetId"]]
        old = old_requests.get(request_id)
        # Older snapshots derive their status from the associated ledger.
        old_status = old.get("status") if old else None
        if old and not old_status:
            old_status = next((item["status"] for item in previous.get("adjustments", []) if item.get("requestId") == request_id), "In approvazione")
        state = request["status"]
        if state not in request_transitions[old_status or "Bozza"] or not old and state not in {"Bozza", "In approvazione"}:
            raise ValueError("Transizione rettifica non consentita")
        if old and old_status in {"Approvata", "Respinta"} and old != request:
            raise ValueError("La rettifica conclusa non può essere modificata")
        if old and old_status == "In approvazione":
            for field in ("budgetId", "year", "reason", "rows"):
                if old.get(field) != request.get(field):
                    raise ValueError("Ritira la richiesta prima di modificarla")
            if old.get("status") and old["changes"] != request["changes"]:
                raise ValueError("Ritira la richiesta prima di modificarla")
        if not request["reason"].strip() or not request["changes"]:
            raise ValueError("Motivazione e variazioni sono obbligatorie")
        records = [item for item in payload["adjustments"] if item.get("requestId") == request_id]
        if len(records) != len(request["changes"]):
            raise ValueError("Righe della richiesta non coerenti con il registro rettifiche")
        levels = {row["id"]: row for row in rows(budget["planning"])}
        for change in request["changes"]:
            row = levels[change["levelId"]]
            year, month = change["year"], change["month"]
            if not isinstance(year, int) or not budget["year"] <= year <= 2100 or not isinstance(month, int) or not 0 <= month <= 11 or (budget["type"] != "Investimento" and year != budget["year"]):
                raise ValueError("Anno o mese rettifica non valido")
            amount = cents(change["amount"])
            if not amount or cents(change["after"]) - cents(change["before"]) != amount:
                raise ValueError("Importo rettifica non valido")
            matching = [item for item in records if item["rowId"] == change["levelId"] and item["year"] == year and item["month"] == month]
            if len(matching) != 1 or matching[0]["scope"] != "planning" or matching[0]["status"] != state or matching[0]["budgetId"] != budget["id"] or cents(matching[0]["amount"]) != amount or matching[0]["reason"] != request["reason"]:
                raise ValueError("Registro rettifiche incoerente")
            if state in {"Bozza", "In approvazione"}:
                cell = (budget["id"], change["levelId"], year, month)
                if cell in cells:
                    raise ValueError("Esiste già una richiesta aperta sulla cella")
                cells.add(cell)
            if not old or state in {"In approvazione", "Approvata"} and state != old_status:
                if budget["workflowState"] != "Approvato" or not budget["isOfficial"]:
                    raise ValueError("Le rettifiche richiedono la versione ufficiale approvata")
                approved = sum(cents(item["amount"]) for item in previous.get("adjustments", []) if item.get("scope") == "planning" and item.get("budgetId") == budget["id"] and item.get("rowId") == change["levelId"] and item.get("year", budget["year"]) == year and item.get("month") == month and item.get("status") == "Approvata")
                if cents(change["before"]) != approved:
                    raise ValueError("I valori ufficiali sono cambiati: aggiorna la proposta")
                values = row["months"] if year == budget["year"] else row.get("yearMonths", {}).get(str(year), [0] * 12)
                if cents(values[month]) + approved + amount < 0:
                    raise ValueError("Il budget mensile non può diventare negativo")
        if old and request.get("events", [])[:len(old.get("events", []))] != old.get("events", []):
            raise ValueError("Lo storico delle decisioni non può essere modificato")
        if old and state != old_status:
            events = request.get("events", [])
            if len(events) <= len(old.get("events", [])) or not events[-1].get("actor") or not events[-1].get("at"):
                raise ValueError("La decisione sulla rettifica deve essere storicizzata")
            if state == "Respinta" and not events[-1].get("note", "").strip():
                raise ValueError("Il rifiuto richiede una motivazione")
    for request_id, old in old_requests.items():
        if request_id not in requests and old.get("status", "In approvazione") != "Bozza":
            raise ValueError("Solo le bozze di rettifica possono essere eliminate")
    request_records = [item for item in payload["adjustments"] if item.get("scope") == "planning" and item.get("requestId")]
    if any(item["requestId"] not in requests for item in request_records):
        raise ValueError("Rettifica senza richiesta associata")
    legacy = {item["id"]: item for item in previous.get("adjustments", []) if item.get("scope") == "planning" and not item.get("requestId")}
    if any(item != legacy.get(item["id"]) for item in payload["adjustments"] if item.get("scope") == "planning" and not item.get("requestId")):
        raise ValueError("Le nuove rettifiche devono avere una richiesta associata")
