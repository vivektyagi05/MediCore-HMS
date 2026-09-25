// Escape user-supplied text before building a MongoDB/JS RegExp from it.
//
// `new RegExp(req.query.x, "i")` on unescaped user input is both a
// ReDoS vector (a crafted pattern like "(a+)+$" can pin a query) and a
// regex-injection vector (the "search" silently becomes a pattern match,
// letting `.` or `|` match far more than the literal text the user typed).
// Every public, unauthenticated search field must go through this first.
export const escapeRegex = (value) => String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build a case-insensitive "contains" RegExp from untrusted input. */
export const containsRegex = (value) => new RegExp(escapeRegex(value), "i");

/** Build a case-insensitive exact-match RegExp from untrusted input. */
export const exactRegex = (value) => new RegExp(`^${escapeRegex(value)}$`, "i");
