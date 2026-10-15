import copy
import json
import shutil
import subprocess
import tempfile
import threading
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

import server
from scripts.erp_actuals import budget_family, seed_actuals, read_actuals


class ErpActualsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.states = json.loads(subprocess.check_output([shutil.which("node"), "tests/helpers/workflow-fixtures.mjs"], cwd=server.ROOT, text=True))
        cls.extended = json.loads(subprocess.check_output([shutil.which("node"), "tests/helpers/workflow-fixtures.mjs", "--extended"], cwd=server.ROOT, text=True))

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        patcher = patch.multiple(server, DATA_DIR=root, DB_PATH=root / "state.db", NORMALIZED_DB_PATH=root / "query.db")
        patcher.start()
        self.addCleanup(patcher.stop)
        server.initialize_database()

    def records(self):
        with closing(server.connect()) as connection:
            return [tuple(row) for row in connection.execute("SELECT * FROM budget_actual ORDER BY budget_name, row_code, period_year, period_month")]

    def test_seed_covers_all_budgets_and_custom_rows_including_drafts(self):
        state = copy.deepcopy(self.states[0])
        custom = copy.deepcopy(state["budgets"][0])
        custom.update(id="custom", name="NUOVO BUDGET", workflowState="Respinto")
        custom["planning"]["level2"][0]["code"] = "CUSTOM-09"
        state["budgets"].append(custom)
        with closing(server.connect()) as connection, connection:
            self.assertEqual(seed_actuals(connection, state), 24)
            for budget in state["budgets"]:
                series = read_actuals(connection, budget)
                self.assertEqual(len(series), 1)
                self.assertEqual(len(series[0]["months"]), 12)
                self.assertTrue(all(isinstance(value, float) for value in series[0]["months"]))
        self.assertEqual(len(self.records()), 24)
        self.assertTrue(all(record[7] > 0 and record[8] == "ERP_SIMULATO" for record in self.records()))

    def test_restart_and_saves_preserve_existing_amounts_and_approved_state(self):
        state = self.states[-1]
        server.write_state(state)
        before = self.records()
        token = server.state_etag(server.read_state())
        server.initialize_database()
        server.write_state(state)
        self.assertEqual(self.records(), before)
        self.assertEqual(server.read_state(), state)
        self.assertEqual(server.state_etag(server.read_state()), token)

    def test_copy_with_new_ids_shares_actuals_and_structures_are_distinct(self):
        state = self.extended[0][-1]
        with closing(server.connect()) as connection, connection:
            self.assertEqual(seed_actuals(connection, state), 12)
            original, copied = state["budgets"]
            self.assertEqual(read_actuals(connection, original), read_actuals(connection, copied))
            other = copy.deepcopy(copied)
            other["associatedStructure"] = "Altra struttura"
            self.assertNotEqual(budget_family(original), budget_family(other))
            self.assertEqual(seed_actuals(connection, {"budgets": [other]}), 12)

    def test_multiyear_includes_intermediate_years_and_snapshot_only_periods(self):
        state = copy.deepcopy(self.extended[1][-1])
        budget = state["budgets"][0]
        budget["planning"]["level1"][0]["yearMonths"] = {}
        budget["revisions"][-1]["planning"]["level1"][0]["yearMonths"]["2030"] = [100] * 12
        with closing(server.connect()) as connection, connection:
            self.assertEqual(seed_actuals(connection, state), 48)
            self.assertEqual({row["year"] for row in read_actuals(connection, budget)}, {2027, 2028, 2029, 2030})

    def test_new_rows_add_only_missing_values_and_projection_failure_rolls_back(self):
        state = copy.deepcopy(self.states[0])
        server.write_state(state)
        original = self.records()
        state["budgets"][0]["planning"]["level2"].append({**state["budgets"][0]["planning"]["level2"][0], "id": "extra", "code": "NEW"})
        with patch.object(server, "build_database", side_effect=RuntimeError("projection failed")):
            with self.assertRaises(RuntimeError):
                server.write_state(state)
        self.assertEqual(self.records(), original)
        self.assertEqual(server.read_state(), self.states[0])
        with closing(server.connect()) as connection, connection:
            self.assertEqual(seed_actuals(connection, state), 12)
        self.assertEqual(len(self.records()), 24)
        self.assertTrue(all(record in self.records() for record in original))

    def test_http_returns_database_values_and_reports_invalid_budget(self):
        server.write_state(self.states[2])
        httpd = server.BudgetHTTPServer(("127.0.0.1", 0), server.BudgetHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{httpd.server_port}/api/actuals"
        try:
            with closing(server.connect()) as connection, connection:
                connection.execute("UPDATE budget_actual SET actual_amount_cents = 123456 WHERE period_month = 1")
            with urlopen(base + "?budgetId=budget") as response:
                payload = json.load(response)
            self.assertEqual(payload["source"], "ERP_SIMULATO")
            self.assertEqual(payload["actuals"][0]["months"][0], 1234.56)
            for suffix, code in [("", 400), ("?budgetId=missing", 404)]:
                with self.assertRaises(HTTPError) as caught:
                    urlopen(base + suffix)
                self.assertEqual(caught.exception.code, code)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join()

    def test_reset_clears_actuals_and_missing_periods_remain_missing_on_read(self):
        server.write_state(self.states[0])
        with closing(server.connect()) as connection, connection:
            connection.execute("DELETE FROM budget_actual WHERE period_month = 2")
            self.assertIsNone(read_actuals(connection, self.states[0]["budgets"][0])[0]["months"][1])
        server.reset_state()
        self.assertEqual(self.records(), [])
        self.assertEqual(server.read_state(), {})


if __name__ == "__main__":
    unittest.main()
