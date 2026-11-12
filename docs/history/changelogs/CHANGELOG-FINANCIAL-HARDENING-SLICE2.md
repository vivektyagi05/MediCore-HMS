> **Historical record.** Preserved as written; it describes the repository at the time of writing and was not re-verified against the current code. For the current verified position see [PROJECT_STATUS](../../PROJECT_STATUS.md) and [REMAINING_RISKS](../../REMAINING_RISKS.md).

# Financial hardening — slice 2
New: `WithdrawalReservationGate`, `ReconciliationRecord`, `walletReconciliationService`, `payments/paymentSplit.js`, `services/financialEmails.js`, `realtime/financeEmitter.js`, FE `hooks/useFinancialSync.js`; tests `withdrawalManualSettlement`, `paymentSplit`, `walletReconciliation`, `financialEmails`, extended gated Mongo suite.
Changed: withdrawals (manual-settlement states, atomic gate reservation, ledger postings, truthful UI), wallet-only appointment payment, outbox routing for receipt/refund/subscription/withdrawal mails, realtime invalidation + refetch on reconnect/resume.
Behavior changes to know about: admin "complete" on a withdrawal now requires a settlement reference and reason and yields `manual_completed`; legacy `completed` rows remain valid; existing doctors' gate counters are initialized lazily from their current withdrawals on first reservation.
