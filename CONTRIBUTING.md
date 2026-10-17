# Contributing to MediCore HMS

Thank you for considering a contribution to MediCore HMS. The project is under active development; its feature status, known gaps, and verification evidence are documented in [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md), [`docs/FEATURES.md`](docs/FEATURES.md), and [`docs/REMAINING_RISKS.md`](docs/REMAINING_RISKS.md).

Contributions may improve application behavior, reliability, security, accessibility, documentation, tests, or developer experience. Please keep changes reviewable and describe what you verified.

## Before you start

Read the documents relevant to your change:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — application structure and domain boundaries.
- [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) — request and data flow.
- [`docs/FINANCIAL_ARCHITECTURE.md`](docs/FINANCIAL_ARCHITECTURE.md) — payments, wallet, refunds, payouts, and financial state transitions.
- [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) — current implementation and verification status.
- [`docs/REMAINING_RISKS.md`](docs/REMAINING_RISKS.md) — known limitations and outstanding risks.
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting and security posture.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — expected community behavior.

For changes involving financial workflows, read the financial architecture before editing code, especially under `backend/payments/` or financial models/services.

## Development environment

### Requirements

Use the Node.js version declared by the repository's `.nvmrc` and `engines` fields (currently Node.js `>=22.12.0` in the package manifests), plus npm and a local or remote MongoDB instance for workflows that need a database.

### Fork, clone, and branch

1. Fork the repository on GitHub.
2. Clone your fork and enter the repository directory.
3. Create a focused branch from `main`:

```bash
git checkout main
git pull origin main
git checkout -b type/short-description
```

Choose a descriptive branch name, such as `fix/wallet-recharge-idempotency` or `docs/deployment-setup`.

### Install dependencies

From the repository root:

```bash
npm ci
```

Install backend dependencies separately:

```bash
npm --prefix backend ci
```

If you are intentionally changing dependencies, use the appropriate install command and include the resulting lockfile changes.

### Configure local environment

Copy the example environment files:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
```

On macOS/Linux:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Set the required local values using the example files and relevant configuration code. Never commit real `.env` files, API keys, JWT secrets, credentials, or real patient/payment data. Use a dedicated test database for integration tests.

## Run the application

Run the frontend from the repository root:

```bash
npm run dev
```

Run the backend in a separate terminal:

```bash
npm --prefix backend run dev
```

Use the URLs and ports printed by the applications or configured in the current environment. Do not assume that a successful frontend start means the backend, database, email provider, or payment gateway is working.

## Checks before opening a pull request

Run the relevant checks for your change. The current CI workflow is [`.github/workflows/ci.yml`](.github/workflows/ci.yml); its jobs install dependencies and run backend tests, MongoDB-backed tests, frontend lint, and frontend build.

From the repository root, run:

```bash
npm run lint
npm run build
npm --prefix backend test
```

MongoDB-backed tests require `MONGODB_TEST_URI` to point to a disposable test database. For example, with a local MongoDB test instance:

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/medicore_hms_test"
npm --prefix backend run test:mongo
```

macOS/Linux:

```bash
MONGODB_TEST_URI="mongodb://127.0.0.1:27017/medicore_hms_test" npm --prefix backend run test:mongo
```

Use only a disposable test database. Never run test or destructive migration commands against production data.

### Existing known failures

The repository's status documents record a verification snapshot in which frontend build succeeded, lint reported seven pre-existing errors, and the backend suite reported 90 passed and 4 failed. These are historical results from that verification pass, not a guarantee of the current branch's status. Check [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) and [`docs/REMAINING_RISKS.md`](docs/REMAINING_RISKS.md), then run the commands yourself before submitting.

If a check fails:

- Determine whether the failure is caused by your change or already exists on the branch.
- Do not hide failures by weakening tests, disabling rules, or removing meaningful assertions.
- Fix failures introduced by your change.
- If an unrelated pre-existing failure blocks validation, disclose the exact command and observed result in the pull request.

## Engineering expectations

- Keep each pull request focused on one logical change.
- Follow existing module and domain boundaries; avoid unnecessary large-scale rewrites.
- Validate inputs and handle errors consistently with neighboring code.
- Preserve authorization checks in backend routes/services; frontend route guards alone are not a security boundary.
- Add or update tests for behavior changes and regression fixes.
- Update documentation when behavior, configuration, endpoints, state transitions, or operational requirements change.
- Use synthetic fixtures. Do not fabricate statistics or present sample records as real production data.
- Do not claim a feature, test, security property, or external integration is verified unless you actually verified it.
- Keep changes accessible and avoid unnecessary dependencies.

## Financial code requires additional review

Changes to `backend/payments/`, payment-related services, and models or workflows for `Payment`, `Wallet`, `Refund`, `Withdrawal`, `TransactionLedger`, or `DoctorPayout` need explicit financial-safety review.

In your pull request description, address each applicable point:

1. **State transitions:** Does the change respect the existing payment, refund, wallet recharge, and withdrawal state machines? If new states or transitions are needed, are they defined and validated?
2. **Idempotency:** Can retries, duplicate webhooks, repeated requests, or double-clicks cause duplicate charges, credits, refunds, or payouts?
3. **Concurrency and atomicity:** Are competing writes protected by atomic conditions, transactions, unique constraints, or another suitable mechanism? Explain any remaining race window.
4. **Ledger consistency:** Does each money-moving state change create the appropriate ledger record, and can partial failure be recovered safely?
5. **Provider authority:** Does the backend verify provider state and validate ownership, amount, currency, and provider references rather than trusting client-reported success?
6. **Reconciliation and recovery:** Can an operator understand discrepancies between internal records and gateway state and resolve pending or failed operations safely?
7. **Tests:** Are retry, duplicate-event, invalid-state, failure, and concurrency cases covered where relevant?

If you cannot verify a point, state that clearly in the pull request instead of assuming it is safe. Passing tests against the in-repository test gateway does not prove the real Razorpay integration works in a live or sandbox environment.

## Security and privacy

Never commit or paste real patient data, medical records, credentials, access tokens, payment information, private keys, or production database dumps. If a secret is exposed, report it privately according to [`SECURITY.md`](SECURITY.md); deleting it from the latest commit alone may not remove it from Git history.

Do not represent the project as HIPAA-compliant, PCI-DSS-certified, or production-hardened unless the relevant requirements and independent evidence have actually been established.

## Commit messages

Use short, descriptive commit messages. Include the affected domain when helpful:

```text
docs: clarify local setup requirements
wallet: prevent duplicate recharge credit
appointments: validate slot ownership
tests: cover refund retry behavior
```

## Pull request checklist

Before requesting review, confirm the following as applicable:

- [ ] The change has a clear scope and rationale.
- [ ] Relevant tests were added or updated.
- [ ] Lint, build, and relevant backend tests were run; results are disclosed accurately.
- [ ] MongoDB-backed tests were run when relevant and used a disposable database.
- [ ] Documentation and configuration examples were updated.
- [ ] No secrets, real patient information, or real payment data are included.
- [ ] Financial state transitions, idempotency, concurrency, ledger consistency, and reconciliation were reviewed when applicable.
- [ ] Known limitations and unverified behavior are clearly stated.

## Review and response times

The project is maintained on a small scale, so review and response times may vary. Opening a pull request does not guarantee acceptance or a particular turnaround time. Constructive feedback and respectful discussion are expected under the [Code of Conduct](CODE_OF_CONDUCT.md).
