// Legacy chat rows were written with deliveredAt = persist time ("delivered"
// the instant ChatMessage.create() succeeded), which only proves the SERVER
// stored the message — never that a device received it. The new engine treats
// deliveredAt as the RECIPIENT's acknowledgement, so legacy fake receipts are
// removed and sentAt is backfilled. Idempotent; touches only rows written by
// the old code path (no clientMessageId). Read messages keep deliveredAt
// (read implies delivered; if it was missing it is set to readAt).
import { connectDB } from "../config/db.js";
import ChatMessage from "../models/ChatMessage.js";

const run = async () => {
  await connectDB();
  const legacy = { clientMessageId: { $exists: false } };
  const sentAt = await ChatMessage.updateMany({ ...legacy, sentAt: { $exists: false } }, [{ $set: { sentAt: "$createdAt" } }]);
  const unfaked = await ChatMessage.updateMany({ ...legacy, readAt: { $exists: false }, deliveredAt: { $exists: true } }, { $unset: { deliveredAt: 1 } });
  const readImpliesDelivered = await ChatMessage.updateMany({ ...legacy, readAt: { $exists: true }, deliveredAt: { $exists: false } }, [{ $set: { deliveredAt: "$readAt" } }]);
  await ChatMessage.syncIndexes();
  console.log(JSON.stringify({ sentAtBackfilled: sentAt.modifiedCount, fakeDeliveryRemoved: unfaked.modifiedCount, deliveredFromRead: readImpliesDelivered.modifiedCount }));
  process.exit(0);
};

if (process.argv[1]?.endsWith("008_chat_message_truthful_state.js")) run().catch((error) => { console.error(error); process.exit(1); });
export { run };
