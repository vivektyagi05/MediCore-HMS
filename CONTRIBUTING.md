# Contributing to MediCore HMS

Thanks for considering contributing. This project is under active
development (see `docs/PROJECT_STATUS.md`) — expect some rough edges, and
please read `docs/ARCHITECTURE.md` and `docs/FINANCIAL_ARCHITECTURE.md`
before touching backend code, especially anything under
`backend/payments/`.

## Getting set up

1. Fork the repository and clone your fork.
2. Create a branch off `main` for your change:
   `git checkout -b your-change-name`.
3. Install dependencies:
   - Frontend: `npm install` (repo root)
   - Backend: `npm install` inside `backend/`
4. Copy `.env.example` to `.env` (and `backend/.env.example` to
   `backend/.env`) and fill in local values. Never commit a real `.env`.

## Before opening a pull request

Run the same checks CI runs (`.github/workflows/ci.yml`):

```bash
npm run lint            # from repo root
npm --prefix backend test
npm run build            # from repo root
```

Note: as of this writing, `npm run lint` and the backend test suite both
have pre-existing failures unrelated to most changes (see
`docs/REMAINING_RISKS.md` §9). You are not expected to fix all of them in
an unrelated PR, but please don't introduce *new* lint errors or test
failures, and mention in your PR description if your change is unaffected
by the existing ones.

## Making changes

- Keep changes focused — one logical change per pull request.
- Update relevant documentation (`docs/`) when you change behavior,
  add an endpoint, or change a financial state machine. Stale docs are
  worse than no docs.
- Do not commit secrets, real credentials, or real patient/payment data —
  see `SECURITY.md`.
- Do not fabricate test data that looks like real production data (real
  names, real payment references, invented statistics). Use clearly
  synthetic examples.

## Changes to financial code (`backend/payments/`, `backend/models/Payment*`,
`Wallet*`, `Refund*`, `Withdrawal*`, `TransactionLedger`, `DoctorPayout`)

These paths get extra scrutiny because a mistake here means real (or
simulated real) money moving incorrectly. For any change touching this
area, your PR description should explicitly address:

- **State-machine review** — does the change respect the existing
  transition tables (`paymentStateMachine.js`, `refundStateMachine.js`,
  `walletRechargeStateMachine.js`, `withdrawalStateMachine.js`), or does it
  introduce a new state/transition that needs one?
- **Idempotency** — can this operation run twice (retry, duplicate
  webhook, double-click) without double-crediting/double-refunding?
- **Concurrency** — is the write atomic (`findOneAndUpdate` with a mutex
  condition, unique index, etc.) or is there a race window?
- **Ledger review** — does every state change that moves money produce a
  corresponding `TransactionLedger` entry?
- **Reconciliation** — can an admin/ops person tell, after the fact,
  whether this operation's outcome matches what the payment gateway
  actually reports?

If you can't answer one of these, say so in the PR rather than guessing —
see `docs/FINANCIAL_ARCHITECTURE.md` for why these distinctions matter.

## Commit messages

Write a short, descriptive summary line. Reference the affected
module/domain where it helps (e.g. `wallet: fix recharge idempotency key
scope`).

## Code style

`eslint.config.js` at the repo root covers both frontend and backend.
There's no separate style guide beyond what ESLint enforces — run
`npm run lint` before pushing.
