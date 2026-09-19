const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const locationRegex = (value) => new RegExp(escapeRegex(String(value).trim()), "i");

export const buildLocationMatch = ({ city, state, district } = {}) => {
  const fields = {};
  if (city?.trim()) fields.city = locationRegex(city);
  if (state?.trim()) fields.state = locationRegex(state);
  if (district?.trim()) fields.district = locationRegex(district);
  return Object.keys(fields).length ? fields : null;
};

// Geographic filters are applied to one location object at a time. This
// prevents false positives such as state from a primary location + city from
// an unrelated clinic. Primary doctor fields and clinic fields share exactly
// the same matching semantics.
export const buildDoctorGeographicFilter = (query = {}) => {
  const match = buildLocationMatch(query);
  if (!match) return null;
  return {
    $or: [
      match,
      { clinics: { $elemMatch: match } },
    ],
  };
};

export const buildLocationAggregationMatch = (query = {}) => {
  const match = buildLocationMatch(query);
  if (!match) return null;
  const locationMatch = {};
  for (const [key, value] of Object.entries(match)) locationMatch[`locations.${key}`] = value;
  return { $match: locationMatch };
};
