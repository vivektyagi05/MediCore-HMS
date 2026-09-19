const SYMPTOM_MAP = [
  {
    keywords: ["chest pain", "breath", "palpitation", "heart"],
    departments: ["Cardiology", "Emergency Medicine"],
    urgency: "urgent",
    flag: "Chest pain or breathing difficulty can be urgent. Seek emergency care if symptoms are severe.",
  },
  {
    keywords: ["fever", "cough", "cold", "throat", "infection"],
    departments: ["General Medicine", "Pulmonology"],
    urgency: "soon",
  },
  {
    keywords: ["headache", "migraine", "dizzy", "seizure", "numb"],
    departments: ["Neurology", "General Medicine"],
    urgency: "soon",
  },
  {
    keywords: ["skin", "rash", "itch", "allergy", "acne"],
    departments: ["Dermatology"],
    urgency: "routine",
  },
  {
    keywords: ["bone", "joint", "knee", "back", "fracture", "sprain"],
    departments: ["Orthopedics", "Physiotherapy"],
    urgency: "soon",
  },
  {
    keywords: ["pregnancy", "period", "pelvic", "gynec"],
    departments: ["Gynecology"],
    urgency: "soon",
  },
  {
    keywords: ["child", "baby", "infant", "pediatric"],
    departments: ["Pediatrics"],
    urgency: "soon",
  },
  {
    keywords: ["tooth", "gum", "dental"],
    departments: ["Dentistry"],
    urgency: "routine",
  },
];

const URGENCY_RANK = { routine: 1, soon: 2, urgent: 3 };

const normalize = (symptom) => symptom.toLowerCase().trim();

export const symptomAnalyzer = {
  analyze({ symptoms, duration, severity }) {
    const normalized = [...new Set(symptoms.map(normalize).filter(Boolean))];
    const matches = [];
    const safetyFlags = [];

    for (const item of SYMPTOM_MAP) {
      const matched = normalized.some((symptom) =>
        item.keywords.some((keyword) => symptom.includes(keyword) || keyword.includes(symptom)),
      );
      if (matched) {
        matches.push(item);
        if (item.flag) safetyFlags.push(item.flag);
      }
    }

    if (severity === "severe") {
      safetyFlags.push("Severe symptoms should be reviewed by a qualified clinician urgently.");
    }

    const departments = matches.flatMap((match) => match.departments);
    const suggestedDepartments = [...new Set(departments.length ? departments : ["General Medicine"])];
    const urgencyRank = Math.max(
      severity === "severe" ? URGENCY_RANK.urgent : severity === "moderate" ? URGENCY_RANK.soon : URGENCY_RANK.routine,
      ...matches.map((match) => URGENCY_RANK[match.urgency]),
    );
    const urgency = Object.entries(URGENCY_RANK).find(([, rank]) => rank === urgencyRank)?.[0] || "routine";

    return {
      symptoms: normalized,
      duration,
      severity,
      urgency,
      suggestedDepartments,
      recommendedSpecialists: suggestedDepartments,
      safetyFlags,
      recommendationText:
        "This is a non-diagnostic triage suggestion. Please consult a licensed clinician for medical advice and seek emergency care for severe or rapidly worsening symptoms.",
      disclaimer:
        "HMS AI does not diagnose medical conditions. It only suggests departments and urgency bands based on entered symptoms.",
    };
  },
};
