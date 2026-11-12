# Environment Variables

> **Status: generated from a static scan of the code** (`process.env.X`, `source.X`, `import.meta.env.X` in `backend/`, `scripts/` and `src/`), cross-checked with `backend/.env.example` and the root `.env.example`. Descriptions are included only where the code makes them clear. Values are never listed here.

Production startup validation lives in `backend/config/productionGuards.js` (`validateProductionConfig`). In production it requires, among others: `MONGO_URI`, `JWT_SECRET` (≥32 chars), `CORS_ORIGIN`, `FRONTEND_URL`, `SERVICE_ROLE`, `PAYMENT_GATEWAY_MODE=razorpay` with Razorpay keys and webhook secret, `BREVO_API_KEY` and a sender email, `AI_TEXT_PROVIDER=gemini` with `GEMINI_API_KEY` and `GEMINI_MODEL`, and valid storage settings; `localhost` is refused for URL settings.

**75 variables found.** The following are read by the backend but appear in **no** `backend/.env.example` entry (documentation gap; the example file was not modified): `AI_HEALTH_CACHE_MS`, `AI_TEXT_PROVIDER`, `AI_TIMEOUT_MS`, `API_BASE`, `DOCTOR_WITHDRAWAL_DAILY_MAX_AMOUNT`, `DOCTOR_WITHDRAWAL_MAX_AMOUNT`, `DOCTOR_WITHDRAWAL_MIN_AMOUNT`, `ENABLE_IN_PROCESS_SCHEDULER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GRIEVANCE_CONTACT_EMAIL`, `LEGAL_CONTACT_EMAIL`, `LGD_CITY_FILE`, `LGD_DISTRICTS_FILE`, `LGD_MASTER_DATA_DIR`, `LGD_SKIP_CHECKSUM`, `LGD_STATES_FILE`, `LOAD_TEST_PASSWORD`, `MONGO_URI_TEST`, `PAYMENT_WINDOW_MINUTES`, `PRIVACY_CONTACT_EMAIL`, `RAZORPAY_ALLOW_TEST_KEYS`, `SEED_LOAD_TEST`, `SERVICE_ROLE`, `SHUTDOWN_FORCE_EXIT_MS`, `STORAGE_DRIVER`, `STORAGE_LOCAL_PERSISTENT`, `STORAGE_LOCAL_ROOT`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_FORCE_PATH_STYLE`, `STORAGE_S3_REGION`, `STORAGE_S3_SECRET_ACCESS_KEY`, `TEST_PAYMENT_GATEWAY_SECRET`. Two files hold examples: `backend/.env.example` (backend) and the root `.env.example` (frontend `VITE_*`, plus payment variables that are actually backend settings).

| Variable | Listed in | First read in | Notes |
|---|---|---|---|
| `AI_HEALTH_CACHE_MS` | **not in any example file** | `backend/config/env.js` | AI health-probe cache duration. |
| `AI_TEXT_PROVIDER` | **not in any example file** | `backend/config/productionGuards.js` | `gemini` or `template`. Production requires `gemini`. `openai` is **not** supported. See [AI architecture](../AI-ARCHITECTURE.md). |
| `AI_TIMEOUT_MS` | **not in any example file** | `backend/config/env.js` | AI provider timeout. |
| `BACKEND_URL` | **not in any example file** | `scripts/production-smoke.mjs` | `scripts/production-smoke.mjs` target. |
| `BCRYPT_SALT_ROUNDS` | backend `.env.example` | `backend/config/env.js` | bcrypt cost (default 12 in the load-test tool). |
| `BREVO_API_KEY` | backend `.env.example` | `backend/config/env.js` | Brevo email API key (required in production). |
| `BREVO_OTP_TEMPLATE_ID` | backend `.env.example` | `backend/config/env.js` | Brevo OTP template id. |
| `BREVO_SENDER_EMAIL` | backend `.env.example` | `backend/config/env.js` | Sender address (required in production). |
| `BREVO_SENDER_NAME` | backend `.env.example` | `backend/config/env.js` | Sender display name. |
| `CHAT_ATTACHMENT_MAX_BYTES` | backend `.env.example` | `backend/config/env.js` | See source. |
| `CHAT_FOLLOWUP_WINDOW_DAYS` | backend `.env.example` | `backend/config/env.js` | See source. |
| `CORS_ORIGIN` | backend `.env.example` | `backend/config/env.js` | Allowed browser origin(s). Required in production; localhost refused. |
| `DOCTOR_WITHDRAWAL_DAILY_MAX_AMOUNT` | **not in any example file** | `backend/services/finance/withdrawalService.js` | Withdrawal limit. |
| `DOCTOR_WITHDRAWAL_MAX_AMOUNT` | **not in any example file** | `backend/services/finance/withdrawalService.js` | Withdrawal limit. |
| `DOCTOR_WITHDRAWAL_MIN_AMOUNT` | **not in any example file** | `backend/services/finance/withdrawalService.js` | Withdrawal limit. |
| `ENABLE_IN_PROCESS_SCHEDULER` | **not in any example file** | `backend/config/productionGuards.js` | Only consulted when `SERVICE_ROLE=all`. See [scheduler](../SCHEDULER-ARCHITECTURE.md). |
| `FRONTEND_URL` | backend `.env.example` | `backend/config/env.js` | Public frontend URL used in links/emails. Required in production; localhost refused. |
| `GEMINI_API_KEY` | **not in any example file** | `backend/config/env.js` | Required when provider is `gemini`. |
| `GEMINI_MODEL` | **not in any example file** | `backend/config/env.js` | Required when provider is `gemini`. |
| `GRIEVANCE_CONTACT_EMAIL` | **not in any example file** | `backend/config/env.js` | See source. |
| `HOSPITAL_ADDRESS` | backend `.env.example` | `backend/config/env.js` | See source. |
| `HOSPITAL_EMAIL` | backend `.env.example` | `backend/config/env.js` | See source. |
| `HOSPITAL_GSTIN` | backend `.env.example` | `backend/config/env.js` | See source. |
| `HOSPITAL_NAME` | backend `.env.example` | `backend/config/env.js` | See source. |
| `HOSPITAL_PHONE` | backend `.env.example` | `backend/config/env.js` | See source. |
| `INVOICE_STORAGE_DIR` | backend `.env.example` | `backend/config/env.js` | See source. |
| `JWT_EXPIRES_IN` | backend `.env.example` | `backend/config/env.js` | JWT lifetime. |
| `JWT_SECRET` | backend `.env.example` | `backend/config/env.js` | JWT signing secret. Production: at least 32 characters, placeholder-like values refused. |
| `LEGAL_CONTACT_EMAIL` | **not in any example file** | `backend/config/env.js` | See source. |
| `LGD_CITY_FILE` | **not in any example file** | `backend/master-data/lgdSource.js` | See source. |
| `LGD_DISTRICTS_FILE` | **not in any example file** | `backend/master-data/lgdSource.js` | See source. |
| `LGD_MASTER_DATA_DIR` | **not in any example file** | `backend/master-data/lgdSource.js` | See source. |
| `LGD_SKIP_CHECKSUM` | **not in any example file** | `backend/master-data/lgdSource.js` | See source. |
| `LGD_STATES_FILE` | **not in any example file** | `backend/master-data/lgdSource.js` | See source. |
| `LOAD_TEST_PASSWORD` | **not in any example file** | `backend/scripts/loadtest/safety.mjs` | Load-test tool only. Min 12 chars. See [load testing](../testing/load-testing.md). |
| `MONGO_URI` | backend `.env.example` | `backend/config/env.js` | MongoDB connection string. Required in production; localhost refused in production. |
| `MONGO_URI_TEST` | **not in any example file** | `backend/scripts/loadtest/safety.mjs` | Load-test tool only: dedicated test database. |
| `PAYMENT_GATEWAY_MODE` | root `.env.example` | `backend/config/productionGuards.js` | `razorpay` or `test`. Production must be `razorpay`. Listed only in the root `.env.example`. |
| `PAYMENT_WINDOW_MINUTES` | **not in any example file** | `backend/config/env.js` | Payment window for pending appointments. |
| `PLATFORM_FEE_PERCENT` | root `.env.example` | `backend/payments/money.js` | Platform fee percentage (`backend/payments/money.js`). Listed only in the root `.env.example`. |
| `PORT` | backend `.env.example` | `backend/config/env.js` | See source. |
| `PRIVACY_CONTACT_EMAIL` | **not in any example file** | `backend/config/env.js` | See source. |
| `PUBLIC_RATE_LIMIT_MAX` | backend `.env.example` | `backend/config/env.js` | See source. |
| `PUBLIC_RATE_LIMIT_WINDOW_MS` | backend `.env.example` | `backend/config/env.js` | See source. |
| `RATE_LIMIT_MAX` | backend `.env.example` | `backend/config/env.js` | See source. |
| `RATE_LIMIT_WINDOW_MS` | backend `.env.example` | `backend/config/env.js` | See source. |
| `RAZORPAY_ALLOW_TEST_KEYS` | **not in any example file** | `backend/config/productionGuards.js` | Explicit opt-in to allow test-mode Razorpay keys under production validation. |
| `RAZORPAY_KEY_ID` | backend `.env.example` | `backend/config/env.js` | Razorpay key id (required in production). |
| `RAZORPAY_KEY_SECRET` | backend `.env.example` | `backend/config/env.js` | Razorpay secret (required in production). |
| `RAZORPAY_WEBHOOK_SECRET` | backend `.env.example` | `backend/config/env.js` | Webhook signature secret (required in production). |
| `SEED_LOAD_TEST` | **not in any example file** | `backend/scripts/loadtest/safety.mjs` | Load-test tool only: must be `1`. |
| `SEED_SUPER_ADMIN_EMAIL` | backend `.env.example` | `backend/scripts/runtime-verification/lib.mjs` | Bootstrap seed (`backend/seed.js`) super-admin email. |
| `SEED_SUPER_ADMIN_NAME` | backend `.env.example` | `backend/seed.js` | Bootstrap seed super-admin name. |
| `SEED_SUPER_ADMIN_PASSWORD` | backend `.env.example` | `backend/scripts/runtime-verification/lib.mjs` | Bootstrap seed super-admin password. |
| `SEO_SITE_URL` | backend `.env.example` | `backend/config/env.js` | Canonical site URL for sitemap/robots. localhost refused in production. |
| `SERVICE_ROLE` | **not in any example file** | `backend/config/productionGuards.js` | `web`, `worker` or `all`. Required in production; `all` additionally requires `ENABLE_IN_PROCESS_SCHEDULER` to be explicit. |
| `SHUTDOWN_FORCE_EXIT_MS` | **not in any example file** | `backend/utils/processResilience.js` | Forced-exit timer during graceful shutdown. |
| `STORAGE_DRIVER` | **not in any example file** | `backend/config/productionGuards.js` | `local` (default) or `s3`. Production rules apply (see `productionGuards.js`). |
| `STORAGE_LOCAL_PERSISTENT` | **not in any example file** | `backend/config/productionGuards.js` | Declares that the local storage path is on persistent disk (production guard). |
| `STORAGE_LOCAL_ROOT` | **not in any example file** | `backend/config/env.js` | See source. |
| `STORAGE_S3_ACCESS_KEY_ID` | **not in any example file** | `backend/config/env.js` | See source. |
| `STORAGE_S3_BUCKET` | **not in any example file** | `backend/config/env.js` | See source. |
| `STORAGE_S3_ENDPOINT` | **not in any example file** | `backend/config/env.js` | See source. |
| `STORAGE_S3_FORCE_PATH_STYLE` | **not in any example file** | `backend/config/env.js` | See source. |
| `STORAGE_S3_REGION` | **not in any example file** | `backend/config/env.js` | See source. |
| `STORAGE_S3_SECRET_ACCESS_KEY` | **not in any example file** | `backend/config/env.js` | See source. |
| `TEST_PAYMENT_GATEWAY_SECRET` | **not in any example file** | `backend/config/productionGuards.js` | Secret for the in-repo test gateway (non-production). |
| `TEST_PAYMENT_SCENARIO` | root `.env.example` | `backend/payments/testGateway.js` | Scenario selector for the test gateway. |
| `TRUST_PROXY` | backend `.env.example` | `backend/config/env.js` | Express trust-proxy setting. |
| `VITE_API_BASE_URL` | root `.env.example` | `src/api/axios.js` | Frontend: API base URL (build-time). |
| `VITE_SITE_URL` | root `.env.example` | `src/config/seo.js` | Frontend: site URL for SEO (build-time). |

Also used by tests/CI: `MONGODB_TEST_URI` (database-backed tests in `backend/tests/mongo/`; set in `.github/workflows/ci.yml`). `NODE_ENV` selects production validation.
