# MediCore HMS — Doctor ↔ Patient Communication: Implementation Report

Date: 2026-10-06 · Input: `MediCore-HMS-P0-ONBOARDING-VALIDATION-CHECKPOINT-2026-09-25.zip`
Labels: **VERIFIED** (ran, evidence below) · **PARTIALLY VERIFIED** · **NOT VERIFIED** · **BLOCKED BY ENVIRONMENT**

## 1. What was found
* Chat existed as pieces: `ChatMessage` model, REST history, socket handlers, a doctor-profile chat box, a bare `/chat/:userId` page. No doctor hub, no patient hub, no conversation list.
* The brief's "storageService" exists (`backend/storage/storageService.js`), used for doctor documents; chat had no attachments.

## 2. What was broken (root causes)
| # | Defect | Root cause | Status |
|---|---|---|---|
| 1 | **UI message sends never reached the server** | Client emitted `chat:message`; server only handled `chat:send`. Nothing in the repo ever emitted `chat:send`. | Fixed + contract test |
| 2 | Fake delivery receipts | `deliveredAt` set at persist time | Fixed + legacy-data migration |
| 3 | Loading a conversation marked everything read | `GET /chat/:id` page 1 auto-marked read | Fixed (explicit read receipt only) |
| 4 | REST could read, socket could not join | Room join required *send* policy, history required *read* policy | One policy, join follows read |
| 5 | No idempotency | Double click / lost ACK / retry could duplicate | `clientMessageId` + unique partial index |
| 6 | Notification leaked message text | First 80 chars of body in notification | Generic text only |
| 7 | Per-socket rate limit bypassable | Counter keyed by socket id | Per-user limiter shared by REST + sockets |
| 8 | Sessions survived password reset on live sockets | Revalidation only on heartbeat | Immediate disconnect + per-event TTL revalidation |
| 9 | `GET` 2 s client cache could hide new messages | Axios GET cache | Chat reads use `dedupe:false` |
| 10 | Uploaded zip lacked `.env.example` files and shipped a real `backend/.env` | Packaging | Restored templates from git; `.env` excluded from the output zip |
| 11 | LGD manifest checksum wrong (startup crash) | Hand-edit | Regenerated with the repo's own `updateLgdManifest.mjs` |

## 3-4. Architecture (one engine)
`CommunicationHub` / `ConversationPanel` → `useConversation` → REST **or** Socket.IO → `conversationEngine` → `resolveChatAccess` (clinicalAccessService) → `chatRepository` (MongoDB) + `storageService`.
No second engine exists; a contract test fails the build if `*ChatEngine/DoctorChat/PatientChat` files appear.

**Policy** (`clinicalAccessService.resolveChatAccess`, pure core `evaluateChatAccess`): pending/cancelled-only pairing → no access. Active appointment or completed within `CHAT_FOLLOWUP_WINDOW_DAYS` → `active`. Relationship existed but window expired → `read_only` (`COMMUNICATION_WINDOW_EXPIRED`); doctor no longer eligible → patient `read_only`, doctor none. Read-only: history, list, room join, receipts, attachment download allowed; send, typing, upload blocked and the UI shows **READ-ONLY · COMMUNICATION WINDOW EXPIRED**. A batch form (`resolveChatAccessBatch`) powers lists with a constant 2 queries and is tested for parity with the per-request decision. super_admin keeps admin↔user support chat only; it never opens a doctor↔patient pair. Only the three runtime roles are accepted.

## 5. Files
**Created (backend):** `services/chat/{chatConstants,slidingWindowLimiter,chatRepository,chatAttachmentService,conversationEngine,chatDirectoryService,chatEngine}.js`, `socket/chatHandlers.js`, `controllers/chatController.js`, `migrations/008_chat_message_truthful_state.js`
**Created (frontend):** `hooks/useConversation.js`, `utils/chatMessageState.js`, `utils/chatEvents.js`, `components/realtime/MessageBubble.jsx`, `pages/chat/CommunicationHub.jsx`
**Created (tests):** `chatEngine`, `chatSocket`, `chatAccessPolicy`, `chatMessageState`, `chatContracts`, `chatRest` + `tests/helpers/chatHarness.mjs`
**Modified:** `models/ChatMessage.js`, `services/clinicalAccessService.js`, `socket/{eventHandlers,roomManager,socketServer}.js`, `controllers/{realtimeController,passwordRecoveryController,admin/userAdminController}.js`, `routes/realtimeRoutes.js`, `config/env.js`, `.env.example`, `package.json` (socket.io-client devDep, `migrate:chat-state`), frontend: `ConversationPanel`, `ChatWorkspace`, `RealtimeContext`, `Sidebar`, `realtimeApi`, `socketEvents`, `AppRoutes`, `navigation`, `DoctorPatients`, `PatientAppointments`; tests updated for new internals: `clinicalAccessPolicy`, `featureToggleEnforcement`.
**Removed (proven obsolete):** `utils/chatReadState.js` + its test (replaced by the engine's atomic read update).

## 6. Data model / indexes
`ChatMessage` gains `clientMessageId`, `sentAt`, `attachment{storageKey(select:false), fileName, mimeType, size, kind}`, `messageType: text|attachment|system`. Indexes: `{conversationKey,_id:-1}` (history/sync), `{recipientId,readAt,conversationKey}` (unread), **unique partial** `{senderId,clientMessageId}` (idempotency), existing `{senderId,recipientId,createdAt:-1}`; redundant single-field indexes removed. Run `npm run migrate:chat-state` once: removes legacy fake `deliveredAt`, backfills `sentAt`, syncs indexes.

## 7. API
`GET /realtime/chat/conversations` (cursor, search, unread) · `GET /chat/contacts` (authorized counterparts, paged) · `GET /chat/unread-count` · `GET /chat/:userId?before=&limit=` · `GET /chat/:userId/sync` · `POST /chat/:userId/messages` (201 new / 200 duplicate) · `POST /chat/:userId/attachments` · `POST /chat/:userId/read` · `POST /chat/:userId/delivered` · `GET /chat/messages/:messageId/attachment`. Errors use the existing `{success,message,details:{code}}` format. **Breaking:** `GET /chat/:userId` now uses `before` cursors (no `page/total`) and no longer marks messages read.

## 8. Socket events
`chat:send` (ack = message ack; duplicate flag) · `chat:message` · `chat:message:delivered` · `chat:message:read` · `chat:typing:start|stop` (server-throttled 1/s, auto-stop 5 s, stop on disconnect) · `chat:sync` (missed messages + receipt updates; marks recipient's messages delivered) · `chat:error`. Sender identity always `socket.user`. Fan-out goes to both participants' user rooms (multi-tab convergence).

## 9. Security controls (each has a test)
IDOR / arbitrary recipient / arbitrary room (strict key parsing, canonical order) / cancelled & pending / expired window / ObjectId & operator injection / duplicate & replay / rate limit across sockets / session invalidation / unauthorized typing & receipts / attachment IDOR (404 for non-participants, conversation-bound, re-checks read policy) / storage-key never serialized / MIME spoof / magic bytes / extension mismatch / double extension / SVG/HTML/exe / active-content PDFs / oversize / path traversal in names / nosniff + no-store + sandbox CSP / no HTML rendering / no bodies in logs.

## 10. Test evidence (this sandbox)
* Backend suite: **152/152 files passing** (baseline 147 with 2 environmental failures; 1 obsolete test removed, 6 chat test files added). ESLint: 0 problems. Vite production build: OK.
* Real Socket.IO + real `socket.io-client`: send, spoof-ignore, idempotent replay, unauthorized pairs, read-only, delivery→read incl. two tabs, receipt abuse, typing/disconnect cleanup, **offline→reconnect→sync with no duplicates**, session invalidation, per-user rate limit — **VERIFIED**.
* REST transport (supertest): status codes, error contract, upload limits, download headers — **VERIFIED**.

## 11. NOT VERIFIED / BLOCKED BY ENVIRONMENT
* **MongoDB-level behaviour — BLOCKED BY ENVIRONMENT** (no reachable Mongo; memory-server binary download blocked). Engine tests use an in-memory repository with the same contract. **Not proven against real Mongo:** the unique-index E11000 race path, the `aggregateConversations` / contacts aggregation pipelines, `updateMany` semantics, index build. Run the migration and a smoke test on a staging DB before release.
* **Browser/E2E of the React UI — NOT VERIFIED.** Components build and lint, and the controller logic (`chatMessageState`) is unit-tested, but nothing was rendered or clicked.
* Real storage provider (S3/Cloudinary-class), Render restart behaviour, multi-instance — not exercised.

## 12. Remaining limitations
* Presence `online` is per-process (`presenceManager`); multi-instance needs the Socket.IO Redis adapter. `lastSeenAt` comes from `OnlineSession`.
* `aggregateConversations` scans a user's messages per page (indexed, but O(messages)). A denormalized conversation-summary collection is the scalable follow-up.
* Unread count is global per user; no per-device read state.
* No message edit/delete/reactions (out of scope). No avatars (initials shown; no avatar field exists on `User`).
* The in-flight retry loop lives in the open tab; a pending message is lost client-side if the tab closes mid-retry (the server may still have it).
* Doctor-profile embedded chat tab uses the same panel, not re-tested in a browser.

## 13. Deployment notes
1. Deploy backend; run `npm run migrate:chat-state` once. 2. Set `CHAT_ATTACHMENT_MAX_BYTES` / `CHAT_FOLLOWUP_WINDOW_DAYS` if defaults are unwanted. 3. Ensure `STORAGE_DRIVER` points at persistent private storage (Render's disk is ephemeral unless a persistent disk/object store is configured). 4. Old clients calling `GET /chat/:id?page=` get the first 30 messages only.
5. `.kilo/worktrees/*` in the uploaded tree is a stale duplicate project; it is excluded from the delivered zip, not deleted from your repo.
