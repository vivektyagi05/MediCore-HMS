import assert from "node:assert/strict";
import { findWalletAnomalies as f } from "../scripts/audit-wallet-precision.mjs";
assert.deepEqual(f({ balance: 100.25, holds: [{ amountPaise: 5000 }] }), []);
assert.deepEqual(f({ balance: 0.1 + 0.2 }), [], "IEEE drift below 1e-6 rupee is tolerated, not flagged");
assert.ok(f({ balance: 10.005 }).length === 1);
assert.ok(f({ balance: -1 }).some((x) => /negative/.test(x)));
assert.ok(f({ balance: 10, holds: [{ amountPaise: 2000 }] }).some((x) => /exceed/.test(x)));
assert.ok(f({ balance: "x" }).length === 1);
console.log("walletPrecisionAudit: 6 checks passed");
