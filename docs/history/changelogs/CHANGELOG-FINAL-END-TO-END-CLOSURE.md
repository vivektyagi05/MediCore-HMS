> **Historical record.** Preserved as written; it describes the repository at the time of writing and was not re-verified against the current code. For the current verified position see [PROJECT_STATUS](../../PROJECT_STATUS.md) and [REMAINING_RISKS](../../REMAINING_RISKS.md).

# CHANGELOG — Final End-to-End Closure

See docs/history/phase-reports/FINAL-END-TO-END-CLOSURE-REPORT.md for evidence and the list of unverified items.

* LGD geography: committed checksummed source + verified importer (36 states / 784 districts / 5,112 cities).
* Fixed Mongoose 9 `pre("validate", next)` crash (MasterData, Invoice, AutomationRunLog).
* Fixed pending-doctor 403 on /api/doctor/onboarding (router-level approval gate shadowing).
* Doctor location: shared State(select) → District(select) → City(text) component, server-side district-scoped city resolution, reset semantics, persistence.
* Public visibility: closed leaks in /api/doctors (email), /ai/search, next-available, related doctors.
* MasterData API: parent required for district/city; search-meta facets from bookable doctors.
* Build identifier; live runtime + jsdom verification harnesses; 8 new tests, 4 stale tests fixed (125/125).
