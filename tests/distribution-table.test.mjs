import test from "node:test";
import assert from "node:assert/strict";

import { distributionRowsHtml } from "../assets/js/components/distribution-table.js";

const dateLabel = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

test("24 rate mensili attraversano l'anno senza perdere importo", () => {
  const html = distributionRowsHtml(
    2400,
    24,
    1,
    new Date(2027, 0, 1),
    dateLabel,
  );
  assert.equal((html.match(/data-distribution-date=/g) || []).length, 24);
  assert.match(html, /data-distribution-date="2028-01-01"/);
  assert.match(html, /data-distribution-date="2028-12-01"/);
  const amounts = [
    ...html.matchAll(/class="distribution-amount"[^>]*value="([\d.]+)"/g),
  ].map((match) => Number(match[1]));
  assert.equal(
    amounts.reduce((sum, value) => sum + value, 0),
    2400,
  );
});

test("una data iniziale a fine mese resta nel mese previsto", () => {
  const html = distributionRowsHtml(
    300,
    3,
    1,
    new Date(2027, 0, 31),
    dateLabel,
  );
  assert.match(html, /data-distribution-date="2027-02-28"/);
  assert.match(html, /data-distribution-date="2027-03-31"/);
});
