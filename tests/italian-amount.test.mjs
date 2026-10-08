import assert from "node:assert/strict";
import test from "node:test";
import { decimalInput, parseItalianAmount } from "../assets/js/core/formatters.js";

test("le rettifiche accettano importi italiani positivi e negativi", () => {
  assert.equal(parseItalianAmount("1.000,50"), 1000.5);
  assert.equal(parseItalianAmount("-50,25"), -50.25);
  assert.equal(parseItalianAmount("1000"), 1000);
  assert.equal(decimalInput.format(1000.5), "1.000,50");
});

test("valori ambigui o con più di due decimali non diventano richieste", () => {
  for (const value of ["", "1.000,555", "1000.50", "1,2,3", "abc"]) {
    assert.equal(parseItalianAmount(value), null);
  }
});
