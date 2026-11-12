import { createHash } from "node:crypto";

// Deterministic ObjectIds that double as a PROVABLE ownership marker.
//   bytes 0-1 : 0x4c 0x54 ("LT")  -> leading timestamp 0x4c54xxxx = Aug 2010, i.e.
//                                    earlier than this product existed, so a real
//                                    document can never fall in this range.
//   bytes 2-5 : first 4 bytes of sha1(namespace)
//   bytes 6-7 : kind code (collection)
//   bytes 8-11: record index
export const KIND = Object.freeze({
  user: 1, doctor: 2, appointment: 3, payment: 4, invoice: 5, payout: 6, ledger: 7,
  refund: 8, note: 9, prescription: 10, review: 11, notification: 12, reminder: 13,
  chat: 14, saved: 15, adminlog: 16, cron: 17, automation: 18,
});

const hex = (n, width) => n.toString(16).padStart(width, "0");
export const nsTag = (ns) => createHash("sha1").update(String(ns)).digest("hex").slice(0, 8);

export const makeId = (ns, kind, index) => {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error(`id index out of range: ${index}`);
  if (!Object.values(KIND).includes(kind)) throw new Error(`unknown kind: ${kind}`);
  return `4c54${nsTag(ns)}${hex(kind, 4)}${hex(index, 8)}`;
};

// Inclusive _id bounds for one collection (kind) of one namespace.
export const idRange = (ns, kind) => {
  const p = `4c54${nsTag(ns)}${hex(kind, 4)}`;
  return { lo: `${p}00000000`, hi: `${p}ffffffff` };
};

export const isOwnedId = (ns, id, kind = null) => {
  const s = String(id).toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(s)) return false;
  if (!s.startsWith(`4c54${nsTag(ns)}`)) return false;
  return kind === null || s.slice(12, 16) === hex(kind, 4);
};
