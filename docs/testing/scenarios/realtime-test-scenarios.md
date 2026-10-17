# HMS Realtime Test Scenarios

## Socket Authentication

- Connect without a token and confirm the socket is rejected.
- Connect with an expired JWT and confirm `connect_error` fires on the client.
- Deactivate a user, reconnect with the old token, and confirm the socket is rejected.

## Reconnection And Recovery

- Disconnect the browser network, create an appointment from another session, reconnect, and confirm missed notifications are fetched from `/api/realtime/notifications`.
- Refresh a logged-in dashboard and confirm the socket reconnects and joins user, role, and admin/doctor/patient rooms.
- Keep a tab idle beyond heartbeat intervals and confirm `OnlineSession.lastActiveAt` updates after reconnect.

## Room Security

- Attempt to join `appointment:<id>` for another patient and confirm the join acknowledgement returns `success: false`.
- Attempt to join `role:admin` as a patient and confirm the join is rejected.
- Attempt to join a chat room that does not include the authenticated user id and confirm the join is rejected.

## Live Dashboard Sync

- Book an appointment as a patient and confirm admin and doctor dashboards refresh without manual page reload.
- Approve an appointment as a doctor and confirm the patient dashboard receives a live status update.
- Capture a payment and confirm finance KPI cards and notification center update.

## Chat And Typing

- Send a doctor-patient chat message and confirm it is persisted in `ChatMessage` and delivered over `chat:message`.
- Hold a key down in the chat input and confirm typing events are rate-limited without disconnecting the socket.
- Mark a message flow as read in a later enhancement and confirm read timestamps do not affect message delivery.

## Notification Delivery

- Emit the same notification event key twice and confirm only one `NotificationDelivery` row exists.
- Mark a notification as read and confirm unread counters decrement.
- Open two tabs for the same user and confirm both receive live notification events while only one persistent delivery row is created.

## Presence

- Connect as a doctor and confirm admins receive `presence:update`.
- Close the doctor tab and confirm the user is marked offline after the final socket disconnects.
- Open two sessions for the same user and confirm offline is not emitted until both sessions disconnect.
