// Repository-controlled canonical vocabulary. This is intentionally small and
// limited to terminology already used by MediCore's existing business logic.
// Geography is not seeded here because the repository does not contain an
// authoritative district/city dataset; legacy geography therefore remains
// OTHER until an authoritative source is introduced.
export const CANONICAL_MASTER_SEEDS = Object.freeze([
  { kind: "specialization", name: "General Medicine" },
  { kind: "specialization", name: "Cardiology" },
  { kind: "specialization", name: "Emergency Medicine" },
  { kind: "specialization", name: "Neurology" },
]);
