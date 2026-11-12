# AI Assistance Architecture

> **Status: derived from `backend/ai/`, `backend/services/ai/` and `backend/config/productionGuards.js`; nothing was executed and no provider was called.** This file exists at this path because `backend/ai/providers/phiMinimizer.js` refers to `docs/AI-ARCHITECTURE.md` for the data flow.

## What is implemented
AI in MediCore is **assistive text generation and rule-based insight**, exposed through the `/api/ai` route group (about 50 registrations in `backend/routes/`; see [API routes](references/api-routes.md)). Rule-based logic (`backend/ai/`) and generative drafting (`backend/ai/generativeAssistant.js`) are separate.

## Provider abstraction
`backend/ai/providers/textGenerationProvider.js` selects a provider from `AI_TEXT_PROVIDER`:

| Value | Meaning |
|---|---|
| `gemini` | Google Gemini. Requires `GEMINI_API_KEY` and `GEMINI_MODEL`; **required in production** |
| `template` | Deterministic template output; intended for development/test |

Any other value — including `openai` — fails configuration validation. Older documents that mention `AI_TEXT_PROVIDER=openai` or `OPENAI_*` variables are **contradicted** by the code (a backend test also asserts no OpenAI references). Related variables: `AI_TIMEOUT_MS`.

## Privacy handling
`providers/phiMinimizer.js` strips direct identifiers before text leaves the process. Its own header states a limitation: **free-text fields are not scrubbed**, so clinical free text can still reach the provider. Treat this as a data-protection risk, not a solved problem (see [Remaining risks](REMAINING_RISKS.md)).

## Human review
The `AIDraft` model carries a `status` of `draft`, `approved` or `discarded` with `approvedAt`/`approvedBy`, so drafts are designed to be reviewed before use. Which endpoints create or consume drafts was not traced in this audit.

## Not verified
Output quality, provider availability, latency and cost were not assessed. Planned or "architecture-ready" AI items in historical changelogs should be checked against code before being treated as implemented.
