// Maps generic, non-diagnostic "concerns" to keywords matched against the
// platform's real specialization list. A concern only renders where a live
// match exists — this is navigation, not a diagnosis or medical claim.
export const CONCERN_KEYWORD_MAP = [
  { key: "skinHair",       keywords: ["derma", "skin", "trichology", "hair"] },
  { key: "heartChest",     keywords: ["cardio", "heart", "pulmonolog"] },
  { key: "bonesJoints",    keywords: ["ortho", "bone", "joint", "rheumat"] },
  { key: "childHealth",    keywords: ["pediatric", "paediatric", "child"] },
  { key: "mentalWellness", keywords: ["psychiat", "psycholog", "mental"] },
  { key: "womensHealth",   keywords: ["gynaec", "gynec", "obstetric", "women"] },
  { key: "eyeCare",        keywords: ["ophthalmolog", "eye"] },
  { key: "digestive",      keywords: ["gastro", "digest"] },
  { key: "dental",         keywords: ["dental", "dentist", "oral"] },
  { key: "generalHealth",  keywords: ["general medicine", "general physician", "internal medicine"] },
];

/**
 * Intersects the curated concern map against a live list of specializations
 * that actually exist on the platform. Returns only concerns with a real
 * match: [{ key, specialization }].
 */
export function matchConcerns(specializations = []) {
  return CONCERN_KEYWORD_MAP
    .map(({ key, keywords }) => {
      const match = specializations.find((s) =>
        keywords.some((kw) => s.toLowerCase().includes(kw)));
      return match ? { key, specialization: match } : null;
    })
    .filter(Boolean);
}
