// ─────────────────────────────────────────────────────────────────────────
// PHASE DOC-03B — real broken link found in the chat end-to-end trace.
//
// ChatMessage.readAt was declared on the schema and READ from in three
// places (doctorController's per-patient unread counts, doctor
// workflowController's clinical-profile unread count, and
// predictionEngine's inbox unread signal) but was never WRITTEN anywhere —
// opening a conversation never marked the other participant's messages as
// read, so "unread" counts could only ever grow. This pure selector is the
// single rule for "which of these already-fetched messages should become
// read because THIS viewer just saw them" — reused by getConversation (the
// only real read point) and covered by a dependency-free regression test.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Given a page of already-fetched conversation messages and the id of the
 * user who just viewed them, return the ids of messages that should now be
 * marked read: unread (no readAt), and addressed TO this viewer (a
 * viewer should never mark their own sent messages "read").
 */
export function selectUnreadMessageIdsForReader(messages, readerId) {
  if (!Array.isArray(messages) || !readerId) return [];
  const readerKey = readerId.toString();

  return messages
    .filter((message) => {
      if (message.readAt) return false;
      const recipientId = message.recipientId?._id || message.recipientId;
      return recipientId && recipientId.toString() === readerKey;
    })
    .map((message) => message._id);
}
