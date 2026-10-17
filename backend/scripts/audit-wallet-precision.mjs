// READ-ONLY audit of wallet balances (Phase 02 closure). Never writes. Reports:
//  - balances that are not an exact multiple of 0.01 (float drift in the rupee-float representation)
//  - negative balances
//  - active holds exceeding the posted balance (a reservation the wallet cannot honour)
// Exit code 0 = clean, 2 = anomalies found, 1 = could not run. Use against a COPY or a read replica when possible.
import mongoose from "mongoose";

export const findWalletAnomalies = (wallet) => {
  const issues = [];
  const balance = Number(wallet.balance);
  if (!Number.isFinite(balance)) { issues.push("balance is not a finite number"); return issues; }
  if (balance < 0) issues.push(`negative balance ${balance}`);
  if (Math.abs(balance * 100 - Math.round(balance * 100)) > 1e-6) issues.push(`balance ${balance} is not a whole number of paise`);
  const held = (wallet.holds || []).reduce((s, h) => s + Number(h.amountPaise || 0), 0);
  if (held > Math.round(balance * 100)) issues.push(`active holds ${held} paise exceed balance ${Math.round(balance * 100)} paise`);
  return issues;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error("MONGO_URI is required"); process.exit(1); }
  await mongoose.connect(uri, { readPreference: "secondaryPreferred" });
  let scanned = 0; const findings = [];
  for await (const wallet of mongoose.connection.collection("wallets").find({}, { projection: { userId: 1, balance: 1, holds: 1 } })) {
    scanned += 1;
    const issues = findWalletAnomalies(wallet);
    if (issues.length) findings.push({ walletId: String(wallet._id), userId: String(wallet.userId), issues });
  }
  console.log(JSON.stringify({ scanned, anomalies: findings.length, findings: findings.slice(0, 200) }, null, 2));
  await mongoose.disconnect();
  process.exit(findings.length ? 2 : 0);
}
