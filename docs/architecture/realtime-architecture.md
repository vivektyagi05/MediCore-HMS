# Realtime Architecture (Socket.IO)

> **Status: derived from `backend/socket/` and `src/socket/socketEvents.js`.** Nothing was executed; multi-instance behaviour is not verified.

## Server modules (`backend/socket/`)
`socketAuth.js` (JWT handshake), `roomManager.js` (room membership), `eventHandlers.js` and chat handlers (client → server events), `presenceManager.js` (presence), `asyncSocketHandler.js` (wraps handlers so an error cannot crash the socket server).

## Client → server events seen in code
`room:join`, `room:leave`, `presence:ping`, `notification:read`, plus chat events defined in `backend/services/chat/chatConstants.js` (`chat:send`, typing start/stop, read/delivered acknowledgements, sync).

## Server → client events (`SOCKET_EVENTS`, `src/socket/socketEvents.js`)
- Session: `socket:ready`, `realtime:error`, `auth:invalidated`, `presence:update`
- Notifications/dashboards: `notification:new`, `dashboard:sync`
- Appointments: `appointment:created|updated|rescheduled|checked_in|called|delay|missed|expired|resolution_required|queue_updated`
- Payments: `payment:captured`, `payment:refund`
- Chat: `chat:message`, `chat:message:delivered`, `chat:message:read`, `chat:sync`, `chat:error`, `chat:typing:start|stop`

Appointment/payment events are **hints to refetch authoritative REST state**, not the source of truth (comment in `socketEvents.js`). Chat event names must match between `chatConstants.js` and the frontend; `backend/tests/chatContracts.test.mjs` is written to fail if they drift (not run here).

## Known limitation
`presenceManager.js` keeps presence in process memory. With more than one web replica, presence is per instance; the repository contains no Socket.IO adapter. This was confirmed by reading the code and is listed in [Remaining risks](../REMAINING_RISKS.md). Only the `web` role serves sockets; the `worker` has no HTTP.
