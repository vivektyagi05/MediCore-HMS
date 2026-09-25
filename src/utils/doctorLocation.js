// Doctor location model shared by DoctorOnboarding and DoctorProfessionalProfile.
//
//   STATE (select)  →  DISTRICT (select)  →  CITY (select)
//
// Every level follows the same MASTER/OTHER shape: a canonical selection sets
// `<level>MasterId`/`<level>Type="MASTER"`, and an explicit "Other" choice sets
// `<level>Type="OTHER"` with the free-typed value in `<level>Other` (the
// display name field itself is never trusted for OTHER — see levelFromDoctor).
// Pure functions only (unit-tested in backend/tests/doctorLocationForm.test.mjs).
// Geography itself is NEVER defined here: states/districts/cities come from
// the canonical MasterData API.

export const OTHER_OPTION = "__other__";

export const EMPTY_LOCATION = Object.freeze({
  state: "", stateMasterId: "", stateType: "", stateOther: "",
  district: "", districtMasterId: "", districtType: "", districtOther: "",
  city: "", cityMasterId: "", cityType: "", cityOther: "",
});

const text = (value) => String(value ?? "").trim();
const keys = (level) => ({ name: level, id: `${level}MasterId`, type: `${level}Type`, other: `${level}Other` });

// The Doctor schema defaults every *Type to "OTHER", so a doctor who never
// chose a location comes back with stateType "OTHER" and nothing else. That must
// read as "not chosen", not as a preselected "Other".
const levelFromDoctor = (doctor, level) => {
  const k = keys(level);
  const id = doctor?.[k.id] ? String(doctor[k.id]) : "";
  const name = text(doctor?.[level]);
  const other = text(doctor?.[k.other]);
  if (id) return { [k.name]: name, [k.id]: id, [k.type]: "MASTER", [k.other]: "" };
  if (other) return { [k.name]: "", [k.id]: "", [k.type]: "OTHER", [k.other]: other };
  return { [k.name]: "", [k.id]: "", [k.type]: "", [k.other]: "" };
};

export const locationFromDoctor = (doctor) => {
  const state = levelFromDoctor(doctor, "state");
  const district = levelFromDoctor(doctor, "district");
  const city = levelFromDoctor(doctor, "city");
  return { ...state, ...district, ...city };
};

const CHILDREN = { state: ["district", "city"], district: ["city"], city: [] };

const clearLevels = (location, levels) => {
  const next = { ...location };
  for (const level of levels) {
    const k = keys(level);
    next[k.name] = ""; next[k.id] = ""; next[k.type] = ""; next[k.other] = "";
  }
  return next;
};

/**
 * Apply a SELECT change for `state` or `district`.
 * `selection`: { id, name } for a canonical value, OTHER_OPTION, or "" (none).
 * Changing a level clears every level below it (no stale values).
 */
export const changeLevel = (location, level, selection) => {
  const k = keys(level);
  const next = clearLevels(location, [level, ...CHILDREN[level]]);
  if (selection === OTHER_OPTION) return { ...next, [k.type]: "OTHER" };
  if (selection && selection.id) return { ...next, [k.name]: selection.name || "", [k.id]: String(selection.id), [k.type]: "MASTER" };
  return next;
};

/** Typing into an "Other" state/district/city text box. Does not clear children. */
export const setOtherText = (location, level, value) => ({ ...location, [keys(level).other]: value });

export const selectValueFor = (location, level) => {
  const k = keys(level);
  return location[k.type] === "OTHER" ? OTHER_OPTION : location[k.id] || "";
};

export const isDistrictChosen = (location) =>
  Boolean(location.districtMasterId) || (location.districtType === "OTHER");

const levelPayload = (location, level) => {
  const k = keys(level);
  if (location[k.type] === "MASTER" && location[k.id]) {
    return { [k.name]: text(location[k.name]), [k.id]: location[k.id], [k.type]: "MASTER", [k.other]: "" };
  }
  if (location[k.type] === "OTHER" && text(location[k.other])) {
    return { [k.name]: "", [k.id]: "", [k.type]: "OTHER", [k.other]: text(location[k.other]) };
  }
  // Explicitly blank: the API clears this level (a stale value stored earlier
  // must not be merged back in).
  return { [k.name]: "", [k.id]: "", [k.type]: "", [k.other]: "" };
};

/**
 * Complete, explicit payload for all three levels, each independently
 * MASTER/OTHER/unset. A level below an unset/cleared parent is never sent
 * (mirrors changeLevel's clearing behavior instead of relying on the caller).
 */
export const buildLocationPayload = (location) => {
  const state = levelPayload(location, "state");
  const district = state.stateType ? levelPayload(location, "district") : levelPayload({}, "district");
  const city = district.districtType ? levelPayload(location, "city") : levelPayload({}, "city");
  return { ...state, ...district, ...city };
};

export const LOCATION_KEYS = Object.freeze(Object.keys(EMPTY_LOCATION));
