# Architecture Report — A6.2.4 — Enterprise Monitoring Platform

## Design principle

The Monitoring Platform is a **read-mostly observability layer**, not a new
execution system. It has exactly one write path (marking a dead-letter
payment reviewed). Every other endpoint reads from data that Phase A6.2.3
(Automation Studio) and Phase A5.2 (Platform Health Center) were already
writing — `AutomationRunLog`, `CronRunLog`, `AutomationFlow.stats` — plus one
pre-existing field set on `Payment` (`retryCount`/`nextRetryAt`/`failedAt`)
that had a writer (`paymentRetryService.js`) but no reader anywhere in the
admin surface.

```
        writes (unchanged)                     reads (new, this phase)
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│ actionExecutor.js            │──────▶ │ AutomationRunLog                  │
│ (Automation Studio, A6.2.3)  │        │                                    │
├─────────────────────────────┤        │  monitoringAggregates.js          │
│ cronRunTracker.js            │──────▶ │   (pure builder functions,        │
│ (Platform Health, A5.2)      │        │    no writes except one)          │
├─────────────────────────────┤        │                                    │
│ paymentRetryService.js       │──────▶ │ Payment.retryCount/nextRetryAt     │
│ (pre-existing)                │        │                                    │
└─────────────────────────────┘        └──────────────┬─────────────────────┘
                                                        │
                                          monitoringController.js
                                          (HTTP boundary — the only
                                           place these are wired to
                                           req/res)
                                                        │
                                          AdminMonitoringPlatform.jsx
                                          (one hub page, 7 tabs)
```

## Why one module, not several controllers

`automationStudioController.js` already owns per-flow reads (one `flowId`
at a time). Rather than scatter cross-flow aggregate logic across that file
and a new one, every cross-flow/cross-job read lives in
`backend/monitoring/monitoringAggregates.js` as plain, testable functions
with no HTTP dependency. `monitoringController.js` is the thin HTTP
adapter. This mirrors the existing `buildPlatformOverviewData` /
`buildExecutiveDashboardData` pattern from A5.1/A5.2 — one builder, reused
by any endpoint that needs the same real numbers, so two pages can never
silently drift into reporting different figures for the same metric.

## Why "Execution" spans two collections (AutomationRunLog + CronRunLog)

The brief's vocabulary ("execution", "trigger", "action", "retry") maps
almost one-to-one onto `AutomationRunLog` (Automation Studio flow runs).
But this codebase's *other* real automation concept — the standalone cron
scripts and on-demand automation jobs tracked by `CronRunLog` — are also
real "executions" with no prior cross-job view. Rather than force cron runs
into the `AutomationRunLog` schema (which would mean fabricating
`triggerType`/`stepResults` for something that isn't a flow), the Execution
Explorer treats `source=flow` and `source=cron` as two real, honestly
different row shapes, normalized only at the list-row level for display.
The Inspector drawer branches on `source` rather than pretending they're
the same document type.

## Why the Payment Retry Queue is its own tab, not folded into Execution Explorer

A payment retry is not an `AutomationRunLog` entry and never will be —
`webhookHandler.js#scheduleFailedPayment` writes directly to `Payment`, with
no flow, trigger, or action step involved at all. Presenting it inside the
Execution Explorer would misrepresent it as an automation-flow execution.
It gets its own tab, clearly labeled, with its own real fields
(`retryCount`, `nextRetryAt`, `failedAt`) rather than being coerced into the
Execution Explorer's row shape.

## Why Execution Timeline is a flat list, not a graph component

`AutomationFlow.actions` is `[actionStepSchema]` — a plain ordered array.
`actionExecutor.js` (Phase A6.2.3, untouched this phase) runs each step
synchronously in array order; there is no fork/join, no parallel branch, no
loop. `buildTimelineFromRun()` in `monitoringAggregates.js` reflects that
directly: it's a pure function producing an ordered list of
`{label, status, message, durationMs}` steps from the run's own
`stepResults` array, unit-tested in `monitoringAggregates.test.mjs`. No
graph-layout library was added because there is no graph to lay out.

## Why AI capabilities stay in the existing pipeline

Every AI capability (`executionExplain`, `failureExplain`,
`performanceAdvisor`, `workflowHealthAdvisor`, `retryAdvisor`) is one more
`promptKey` in the same `promptLibrary.js` → `generativeAssistant.js` →
`textGenerationProvider.js` → `templateProvider.js` pipeline every other AI
feature in this codebase uses. No new chatbot, no new provider, no new
generation path — consistent with the brief's own "Reuse existing AI
pipeline... NO new chatbot" instruction. Each renderer function is a pure,
dependency-free function taking only the exact real fields the controller
fetched — never a live DB handle — so it can never fabricate a number that
wasn't already computed by a real aggregate.

## Why realtime needed zero backend changes

`dashboardSyncTick` (from `RealtimeContext.jsx`) is a generic tick already
incremented on the existing socket connection and already consumed by every
other admin dashboard page (Mission Control, Platform Health, Operations
Center, Smart Assignment). `AdminMonitoringPlatform.jsx`'s Dashboard tab
subscribes to it exactly the same way — re-fetching `/overview` whenever it
changes — so "Reuse existing Socket system. No new sockets." is satisfied
with a one-line `useEffect` dependency, not a single line of backend socket
code.
