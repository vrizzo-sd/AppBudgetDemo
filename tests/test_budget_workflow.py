import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from scripts.budget_workflow_validation import validate_state


class BudgetWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = os.environ.get("BUDGET_TEST_NODE") or shutil.which("node")
        if not node:
            raise RuntimeError("Node.js necessario per verificare i payload reali del frontend")
        cls.states = json.loads(subprocess.check_output([node, "tests/helpers/workflow-fixtures.mjs"], cwd=server.ROOT, text=True))
        cls.extended = json.loads(subprocess.check_output([node, "tests/helpers/workflow-fixtures.mjs", "--extended"], cwd=server.ROOT, text=True))

    def test_versions_with_pending_history_and_multiyear_match_server(self):
        for scenario in self.extended:
            previous = {}
            for state in scenario:
                validate_state(state, previous)
                previous = state

    def test_draft_edit_and_submit_preserves_audit(self):
        state = copy.deepcopy(self.states[4])
        state["monthlyHistory"][0]["events"].insert(0, {"action": "edit", "actor": "Utente demo", "at": "2026-10-15T12:00:00Z"})
        validate_state(state, self.states[3])

    def test_frontend_scenario_matches_server_rules(self):
        previous = {}
        for state in self.states:
            validate_state(state, previous)
            previous = state

    def test_incomplete_draft_can_be_saved_but_not_submitted(self):
        state = copy.deepcopy(self.states[0])
        state["budgets"][0]["planning"]["level2"][0]["months"][0] = 10
        validate_state(state, self.states[0])
        state["budgets"][0]["workflowState"] = "In approvazione"
        with self.assertRaises(ValueError):
            validate_state(state, self.states[0])

    def test_duplicate_versions_are_rejected(self):
        state = copy.deepcopy(self.states[0])
        duplicate = copy.deepcopy(state["budgets"][0]); duplicate["id"] = "copy"
        state["budgets"].append(duplicate)
        with self.assertRaisesRegex(ValueError, "univoci"):
            validate_state(state, self.states[0])

    def test_approved_base_cannot_be_edited_or_deleted(self):
        for field in ("planning", "baseSnapshot"):
            state = copy.deepcopy(self.states[5])
            state["budgets"][0][field]["level2"][0]["months"][0] = 0
            with self.assertRaises(ValueError):
                validate_state(state, self.states[5])

    def test_approved_revision_and_request_are_immutable(self):
        state = copy.deepcopy(self.states[5])
        state["budgets"][0]["revisions"][0]["planning"]["level2"][0]["months"][0] = 0
        with self.assertRaisesRegex(ValueError, "revisioni"):
            validate_state(state, self.states[5])
        state = copy.deepcopy(self.states[5])
        state["monthlyHistory"][0]["reason"] = "Manipolata"
        with self.assertRaisesRegex(ValueError, "conclusa"):
            validate_state(state, self.states[5])

    def test_forged_revision_and_mismatched_ledger_are_rejected(self):
        state = copy.deepcopy(self.states[5])
        state["budgets"][0]["revisions"][-1]["planning"]["level2"][0]["months"][0] = 999
        with self.assertRaisesRegex(ValueError, "revisione"):
            validate_state(state, self.states[4])
        state = copy.deepcopy(self.states[4])
        state["adjustments"][0]["amount"] = 999
        with self.assertRaisesRegex(ValueError, "Registro"):
            validate_state(state, self.states[3])

    def test_pending_proposal_must_be_withdrawn_before_editing(self):
        state = copy.deepcopy(self.states[4])
        state["monthlyHistory"][0]["reason"] = "Modifica diretta"
        with self.assertRaisesRegex(ValueError, "Ritira"):
            validate_state(state, self.states[4])

    def test_multiple_official_versions_are_rejected(self):
        state = copy.deepcopy(self.states[2])
        other = copy.deepcopy(state["budgets"][0]); other["id"] = "copy"; other["version"] = 2
        previous = copy.deepcopy(self.states[1])
        old_other = copy.deepcopy(previous["budgets"][0]); old_other["id"] = "copy"; old_other["version"] = 2
        state["budgets"].append(other); previous["budgets"].append(old_other)
        with self.assertRaisesRegex(ValueError, "sola versione"):
            validate_state(state, previous)

    def test_draft_request_can_be_deleted(self):
        state = copy.deepcopy(self.states[3])
        state["monthlyHistory"] = []; state["adjustments"] = []
        validate_state(state, self.states[3])

    def test_sqlite_roundtrip_and_projection_failure_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.multiple(server, DATA_DIR=Path(directory), DB_PATH=Path(directory)/"state.db", NORMALIZED_DB_PATH=Path(directory)/"query.db"):
                server.initialize_database()
                for state in self.states:
                    server.write_state(state)
                    self.assertEqual(server.read_state(), state)
                with patch.object(server, "build_database", side_effect=RuntimeError("projection failed")):
                    with self.assertRaises(RuntimeError):
                        server.write_state(self.states[0])
                self.assertEqual(server.read_state(), self.states[-1])

    def test_http_save_confirmation_conflict_and_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.multiple(server, DATA_DIR=Path(directory), DB_PATH=Path(directory)/"state.db", NORMALIZED_DB_PATH=Path(directory)/"query.db"):
                server.initialize_database()
                httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.BudgetHandler)
                thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
                url = f"http://127.0.0.1:{httpd.server_port}/api/state"
                try:
                    with urlopen(url) as response:
                        token = response.headers["ETag"]
                    for state in self.states:
                        request = Request(url, json.dumps(state).encode(), {"Content-Type": "application/json", "If-Match": token}, method="PUT")
                        with urlopen(request) as response:
                            token = response.headers["ETag"]
                            self.assertTrue(json.load(response)["ok"])
                    with urlopen(url) as response:
                        self.assertEqual(json.load(response), self.states[-1])
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(url, json.dumps(self.states[0]).encode(), {"If-Match": '"stale"'}, method="PUT"))
                    self.assertEqual(error.exception.code, 409)
                    altered = copy.deepcopy(self.states[-1]); altered["budgets"][0]["name"] = "Alterato"
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(url, json.dumps(altered).encode(), {"If-Match": token}, method="PUT"))
                    self.assertEqual(error.exception.code, 400)
                finally:
                    httpd.shutdown(); httpd.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
