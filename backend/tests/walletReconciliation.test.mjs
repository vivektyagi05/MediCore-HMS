import assert from "assert";
import { computeDrift } from "../services/finance/walletReconciliationService.js";
assert.deepStrictEqual(computeDrift({ expectedPaise: 50000, actualPaise: 50000 }), { expectedPaise: 50000, actualPaise: 50000, driftPaise: 0, ok: true });
const d = computeDrift({ expectedPaise: 50000, actualPaise: 60000 });
assert.strictEqual(d.ok, false);
assert.strictEqual(d.driftPaise, 10000, "positive drift = wallet holds more than the ledger explains");
assert.strictEqual(computeDrift({ expectedPaise: 50000, actualPaise: 40000 }).driftPaise, -10000);
console.log("PASS: wallet reconciliation drift math");
process.exit(0);
