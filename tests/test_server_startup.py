import unittest
from unittest.mock import patch

import server


class ServerStartupTests(unittest.TestCase):
    def test_second_server_cannot_share_the_same_port(self):
        first = server.BudgetHTTPServer(("127.0.0.1", 0), server.BudgetHandler)
        try:
            with self.assertRaises(OSError):
                server.BudgetHTTPServer(first.server_address, server.BudgetHandler)
        finally:
            first.server_close()

    def test_busy_port_does_not_initialize_or_modify_database(self):
        with patch.object(server, "BudgetHTTPServer", side_effect=OSError("Porta occupata")), patch.object(server, "initialize_database") as initialize:
            with self.assertRaisesRegex(SystemExit, "Ctrl\\+C"):
                server.main()
            initialize.assert_not_called()
