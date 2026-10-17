# Testing and release gates

This page documents available commands and how to describe evidence. It does not report a new test run.

## Commands defined by the root manifest

Run from the repository root:

```bash
npm run lint
npm run build
npm run test:backend
```

The root `test:backend` script delegates to `npm --prefix backend test`. The backend manifest also defines:

```bash
npm --prefix backend test
npm --prefix backend run test:mongo
```

The MongoDB suite requires the connection/environment setup expected by the test files. Read the relevant test file before running it, and use a dedicated test database. The existence of a script does not prove that it passes.

## Evidence levels

| Evidence level | What it supports | What it does not prove |
|---|---|---|
| Source reference | A file, route, model, or symbol exists | Correct behavior |
| Static/unit tests | Tested logic under the test setup | Real database or external service behavior |
| Real MongoDB integration | Behavior exercised against the configured MongoDB test instance | Production database correctness |
| Browser end-to-end | The exercised user journey in the stated environment | All browsers, roles, or edge cases |
| Gateway sandbox | The specific payment flow exercised against the gateway sandbox | Live settlement or production operations |
| Container/CI | The recorded build or workflow in the named runner | Deployment health |
| Production verification | A dated check of the actual deployed system | Future availability or regulatory compliance |

## Conflicting historical results

The supplied reports contain different totals, including 90 passed / 4 failed, 185/185, and 190/190. They are retained as historical records under `history/`; they have not been reconciled to one commit and environment. The current result is **Unverified**. This task did not run tests.

When recording a new result, include the commit hash, date/time, Node/npm versions, exact command, exit code, test count, database/gateway mode, and any skipped or blocked checks.

## Release gates

Do not describe a release as verified until the gates relevant to that release have evidence:

1. Lint and frontend build complete on the candidate commit.
2. Backend tests complete; failures and skips are explained.
3. MongoDB integration tests run against a dedicated test instance when database invariants are relevant.
4. Browser journeys cover the affected roles and workflows.
5. Payment changes are exercised using a gateway sandbox, never by an unplanned live transaction.
6. Container and CI results are recorded from the actual runner.
7. Deployment configuration, health checks, storage persistence, backups, and restore procedures are checked in the target environment.
8. Open risks are documented and accepted by the release owner.

Do not combine unit-test, integration-test, sandbox, and production results into one undifferentiated “passed” count.
