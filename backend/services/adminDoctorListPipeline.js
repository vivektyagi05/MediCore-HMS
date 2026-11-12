// Pipeline builders for the admin Doctors list (S4: A-04, A-05, A-08). Pure functions, no DB access, so the stage order
// and the field allowlist can be regression-tested.
//
// What changed versus the previous inline pipeline, and what deliberately did not:
//  - A-05: the joined user is projected to an ALLOWLIST inside the $lookup. `$lookup` ignores Mongoose `select:false`, so
//    the old `$project: { "user.password": 0 }` let emailVerification*/securityVersion hashes reach the browser. Fields
//    that are not listed never leave the database. `documents[].storageKey` (internal storage detail, stripped by the
//    detail endpoint) is excluded from the list as well.
//  - A-08: every sort ends with `_id` in the same direction so skip/limit paging is stable.
//  - A-04: the per-doctor appointment COUNT now runs after $skip/$limit (only for the page) unless the sort is
//    `activity`, which needs the count for every matching doctor. The inner join on users (and the optional search match)
//    still happens before paging, exactly as before, so which doctors are in the result, `total`, and the response shape
//    are unchanged.
export const DOCTOR_LIST_USER_FIELDS = Object.freeze({ name: 1, email: 1, isActive: 1, createdAt: 1 });

export const DOCTOR_LIST_SORTS = Object.freeze({
  name_asc: { "user.name": 1, _id: 1 },
  newest: { createdAt: -1, _id: -1 },
  rating: { rating: -1, _id: -1 },
  experience: { experience: -1, _id: -1 },
  activity: { appointmentCount: -1, _id: -1 },
});

export function resolveDoctorListSort(key) {
  const sortKey = Object.prototype.hasOwnProperty.call(DOCTOR_LIST_SORTS, key) ? key : "newest";
  return { sortKey, sortBy: DOCTOR_LIST_SORTS[sortKey] };
}

const userJoinStages = () => [
  {
    $lookup: {
      from: "users",
      let: { userId: "$userId" },
      pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$userId"] } } }, { $project: { ...DOCTOR_LIST_USER_FIELDS } }],
      as: "user",
    },
  },
  { $unwind: "$user" },
];

const searchStage = (searchTerm) => ({ $match: { $or: [{ "user.name": searchTerm }, { "user.email": searchTerm }] } });

const appointmentCountStages = () => [
  {
    $lookup: {
      from: "appointments",
      let: { doctorId: "$_id" },
      pipeline: [{ $match: { $expr: { $eq: ["$doctorId", "$$doctorId"] } } }, { $count: "count" }],
      as: "appointmentStats",
    },
  },
  { $addFields: { appointmentCount: { $ifNull: [{ $arrayElemAt: ["$appointmentStats.count", 0] }, 0] } } },
];

export function buildDoctorListPipeline({ match, searchTerm, sortKey, skip, limit }) {
  const { sortBy } = resolveDoctorListSort(sortKey);
  const countFirst = sortKey === "activity";
  return [
    { $match: match },
    ...userJoinStages(),
    ...(searchTerm ? [searchStage(searchTerm)] : []),
    ...(countFirst ? appointmentCountStages() : []),
    { $sort: sortBy },
    { $skip: skip },
    { $limit: limit },
    ...(countFirst ? [] : appointmentCountStages()),
    {
      $addFields: {
        pendingDocumentsCount: {
          $size: { $filter: { input: { $ifNull: ["$documents", []] }, cond: { $eq: ["$$this.status", "pending"] } } },
        },
      },
    },
    { $project: { appointmentStats: 0, "documents.storageKey": 0 } },
  ];
}

export function buildDoctorCountPipeline({ match, searchTerm }) {
  return [{ $match: match }, ...(searchTerm ? [...userJoinStages(), searchStage(searchTerm)] : []), { $count: "total" }];
}
