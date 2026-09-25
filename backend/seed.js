import crypto from "crypto";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import Permission, { PERMISSION_KEYS } from "./models/Permission.js";
import Service from "./models/Service.js";
import CMSPage from "./models/CMSPage.js";
import User from "./models/User.js";
import FeatureToggle from "./models/FeatureToggle.js";
import HospitalSetting from "./models/HospitalSetting.js";

const adminEmail = process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@hms.local";
const adminName = process.env.SEED_SUPER_ADMIN_NAME || "HMS Super Admin";

// SECURITY FIX: this used to fall back to one specific hardcoded literal
// password whenever SEED_SUPER_ADMIN_PASSWORD was unset -- in
// production that meant every deployment that forgot to set the variable
// silently got the exact same super_admin password, publishable in this
// very file. Production now REFUSES to seed without an explicit password
// (env.isProduction is the same guard config/productionGuards.js already
// uses). Development/test may still run with zero setup: a fresh random
// password is generated per run and printed once, never hardcoded.
let adminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
let generatedAdminPassword = false;
if (!adminPassword) {
  if (env.isProduction) {
    throw new Error("SEED_SUPER_ADMIN_PASSWORD is required to seed the super_admin account in production");
  }
  adminPassword = crypto.randomBytes(18).toString("base64url");
  generatedAdminPassword = true;
}

const allPermissions = PERMISSION_KEYS.reduce((acc, key) => {
  acc[key] = true;
  return acc;
}, {});

// These are configurable demo/platform prices for the MediCore product surface;
// they are not claims about any real hospital tariff.
const defaultServices = [
  {
    title: "General Physician Consultation", slug: "general-physician-consultation", shortDescription: "First-contact medical consultation for common symptoms, ongoing conditions, and preventive care planning.", description: "A general physician consultation focused on understanding symptoms, reviewing relevant history, assessing current concerns, and deciding whether further testing, treatment, or specialist referral is appropriate.", benefits: ["Structured symptom review", "Medication and history review", "Care-plan discussion", "Referral when specialist care is appropriate"], eligibility: "Suitable for adults and children when the concern can be assessed by a general physician.", preparation: "Keep a list of current medicines, allergies, previous diagnoses, and recent reports available.", procedureInformation: "The clinician reviews the concern and history, performs an appropriate clinical assessment, and explains next steps.", duration: "20–30 minutes", consultationModes: ["online", "in_clinic"], price: 800, category: "Consultation", relatedSpecialties: ["General Medicine", "Family Medicine"], status: "published", visibility: "public", icon: "stethoscope", displayOrder: 1, seo: { title: "General Physician Consultation | MediCore HMS", description: "General physician consultation for symptoms, follow-up care, and preventive health planning." },
  },
  {
    title: "Cardiology Consultation", slug: "cardiology-consultation", shortDescription: "Specialist consultation for heart-health concerns, risk assessment, and follow-up planning.", description: "A cardiology consultation for evaluation of cardiovascular symptoms and risk factors, review of existing cardiac reports, and planning of appropriate follow-up or investigations.", benefits: ["Cardiac history review", "Risk-factor discussion", "Report review", "Specialist care planning"], eligibility: "For people with cardiovascular concerns, known cardiac conditions, or a referral for specialist assessment.", preparation: "Bring previous ECGs, imaging, laboratory reports, medication lists, and relevant family history when available.", procedureInformation: "The cardiology team reviews the available information and determines appropriate next steps based on the individual presentation.", duration: "30 minutes", consultationModes: ["online", "in_clinic"], price: 1500, category: "Specialist", relatedSpecialties: ["Cardiology"], status: "published", visibility: "public", icon: "heart-pulse", displayOrder: 2, seo: { title: "Cardiology Consultation | MediCore HMS", description: "Cardiology consultation for cardiovascular symptoms, risk assessment, and follow-up planning." },
  },
  {
    title: "Dermatology Consultation", slug: "dermatology-consultation", shortDescription: "Specialist assessment for common skin, hair, and nail concerns.", description: "A dermatology consultation to review skin, hair, or nail concerns, discuss relevant history, and determine whether clinical treatment or additional assessment is appropriate.", benefits: ["Skin concern assessment", "Medication review", "Treatment discussion", "Follow-up planning"], eligibility: "For persistent, recurrent, or concerning skin, hair, and nail symptoms.", preparation: "Bring a list of skin products and medicines you currently use and note when the concern started.", procedureInformation: "The clinician reviews the concern, relevant history, and available images or reports before recommending appropriate next steps.", duration: "20–30 minutes", consultationModes: ["online", "in_clinic"], price: 1200, category: "Specialist", relatedSpecialties: ["Dermatology"], status: "published", visibility: "public", icon: "scan-face", displayOrder: 3, seo: { title: "Dermatology Consultation | MediCore HMS", description: "Dermatology consultation for skin, hair, and nail concerns." },
  },
  {
    title: "Pediatric Consultation", slug: "pediatric-consultation", shortDescription: "Child-focused consultation for common illnesses, development concerns, and follow-up care.", description: "A pediatric consultation designed around the child's age, symptoms, medical history, and caregiver concerns, with referral or further evaluation when required.", benefits: ["Age-appropriate assessment", "Growth and development discussion", "Medication review", "Follow-up planning"], eligibility: "For infants, children, and adolescents when pediatric clinical assessment is appropriate.", preparation: "Bring vaccination information, current medicines, previous reports, and a clear timeline of the child's symptoms.", procedureInformation: "The pediatrician reviews the child's history and current concern, then explains the recommended care or follow-up pathway.", duration: "20–30 minutes", consultationModes: ["online", "in_clinic"], price: 1000, category: "Pediatrics", relatedSpecialties: ["Pediatrics"], status: "published", visibility: "public", icon: "baby", displayOrder: 4, seo: { title: "Pediatric Consultation | MediCore HMS", description: "Pediatric consultation for children's symptoms, development concerns, and follow-up care." },
  },
  {
    title: "Preventive Health Checkup", slug: "preventive-health-checkup", shortDescription: "A structured preventive consultation to review health risks and appropriate screening needs.", description: "A preventive health checkup helps organize a person's health history, risk factors, lifestyle considerations, and clinically appropriate screening or follow-up needs.", benefits: ["Health-risk review", "Lifestyle discussion", "Screening-plan discussion", "Follow-up recommendations"], eligibility: "For people seeking preventive health planning or a periodic health review.", preparation: "Bring previous reports, medicine lists, known conditions, allergies, and family history when relevant.", procedureInformation: "A clinician reviews the available information and recommends screening or follow-up based on age, history, symptoms, and risk factors.", duration: "30 minutes", consultationModes: ["online", "in_clinic"], price: 900, category: "Preventive Care", relatedSpecialties: ["General Medicine", "Family Medicine"], status: "published", visibility: "public", icon: "clipboard-check", displayOrder: 5, seo: { title: "Preventive Health Checkup | MediCore HMS", description: "Preventive health consultation for risk review and appropriate screening planning." },
  },
  {
    title: "Diagnostic Report Review", slug: "diagnostic-report-review", shortDescription: "Clinician-led review of medical reports with clear next-step discussion.", description: "A report-review consultation helps patients understand what their available medical reports contain and what questions, follow-up, or clinical evaluation may be appropriate.", benefits: ["Report walkthrough", "Contextual explanation", "Questions for follow-up", "Care-pathway discussion"], eligibility: "For patients who already have medical reports and want a clinician to review them in context.", preparation: "Upload or bring the complete report, including reference ranges and previous related reports when available.", procedureInformation: "The clinician reviews the report alongside the available history and explains what should be discussed or followed up clinically.", duration: "20 minutes", consultationModes: ["online", "in_clinic"], price: 500, category: "Diagnostics", relatedSpecialties: ["General Medicine", "Pathology"], status: "published", visibility: "public", icon: "file-text", displayOrder: 6, seo: { title: "Diagnostic Report Review | MediCore HMS", description: "Clinician-led review of diagnostic reports and discussion of appropriate next steps." },
  },
];

const defaultArticles = [
  { slug: "when-should-you-see-a-general-physician", title: "When Should You See a General Physician?", excerpt: "A practical guide to using primary care for new symptoms, ongoing concerns, prevention, and referral decisions.", category: "Primary Care", tags: ["primary care", "consultation", "prevention"], content: "<p>Primary care is often the first point of contact when you have a new health concern, need follow-up for an existing condition, or want help planning preventive care.</p><h2>When a consultation can help</h2><p>A clinician can review symptoms, medicines, medical history, and relevant reports, then decide whether monitoring, treatment, testing, or specialist referral is appropriate.</p><h2>Prepare useful information</h2><p>Bring a list of current medicines, allergies, important diagnoses, recent reports, and the main questions you want answered. A short timeline of symptoms can also make the consultation more useful.</p><h2>When symptoms are urgent</h2><p>Severe or rapidly worsening symptoms should be assessed through an appropriate urgent or emergency service rather than waiting for a routine appointment.</p><p><strong>Important:</strong> This article is general educational information and does not replace an individualized clinical assessment.</p>", references: [{ title: "Primary health care", url: "https://www.who.int/news-room/questions-and-answers/item/primary-health-care", organization: "World Health Organization" }], status: "published", visibility: "public", isPublished: true, seo: { title: "When Should You See a General Physician? | MediCore HMS", description: "How primary care can help with new symptoms, follow-up care, prevention, and referrals." } },
  { slug: "understanding-blood-pressure", title: "Understanding Blood Pressure and When to Seek Care", excerpt: "What blood pressure readings mean, why regular checks matter, and why very high readings with concerning symptoms need prompt medical attention.", category: "Heart Health", tags: ["blood pressure", "hypertension", "heart health"], content: "<p>Blood pressure is recorded as two numbers: systolic pressure when the heart contracts and diastolic pressure when it relaxes between beats.</p><h2>Why checking matters</h2><p>High blood pressure may cause no noticeable symptoms, so measurement is important. A clinician can interpret readings alongside your age, medical history, medicines, and other risk factors.</p><h2>When to seek urgent care</h2><p>Very high blood pressure accompanied by symptoms such as chest pain, difficulty breathing, severe headache, confusion, or vision changes requires immediate medical attention.</p><h2>Keep a record</h2><p>If your clinician asks you to monitor blood pressure, record readings consistently and bring them to follow-up visits. Do not change prescribed medicines without professional advice.</p><p><strong>Important:</strong> This article is educational and is not a diagnosis or individualized treatment plan.</p>", references: [{ title: "Hypertension", url: "https://www.who.int/news-room/fact-sheets/detail/hypertension", organization: "World Health Organization" }], status: "published", visibility: "public", isPublished: true, seo: { title: "Understanding Blood Pressure | MediCore HMS", description: "Educational guidance on blood pressure readings, monitoring, and urgent warning signs." } },
  { slug: "prepare-for-doctor-consultation", title: "How to Prepare for a Doctor Consultation", excerpt: "Simple steps that can make a medical consultation clearer and more useful.", category: "Patient Guide", tags: ["appointments", "doctor visit", "patient guide"], content: "<p>A little preparation can make it easier to explain your concern and remember the questions you want to ask.</p><h2>Before the visit</h2><p>Write down your main symptoms, when they started, what makes them better or worse, and your two or three most important questions.</p><h2>Bring your medication information</h2><p>Keep a list of prescription medicines, over-the-counter medicines, vitamins, and supplements. Also note important allergies and previous diagnoses.</p><h2>Ask about next steps</h2><p>Useful questions include what the tests are for, when results will be available, what the treatment plan involves, and when follow-up is needed.</p><p><strong>Important:</strong> The right preparation varies by appointment type. Follow any specific instructions provided by your clinician or hospital.</p>", references: [{ title: "What to ask your doctor or other healthcare professional", url: "https://www.nhs.uk/nhs-services/gps/what-to-ask-your-doctor/", organization: "NHS" }], status: "published", visibility: "public", isPublished: true, seo: { title: "How to Prepare for a Doctor Consultation | MediCore HMS", description: "Practical preparation tips for symptoms, medicines, questions, and follow-up planning." } },
  { slug: "warning-signs-that-need-urgent-care", title: "Warning Signs That Require Urgent Medical Attention", excerpt: "Recognize a few important warning patterns where waiting for a routine appointment may be unsafe.", category: "Patient Safety", tags: ["urgent care", "emergency", "patient safety"], content: "<p>Some symptoms can indicate a medical emergency and should not be managed by waiting for a routine appointment.</p><h2>Examples of warning signs</h2><p>Sudden facial drooping, new weakness of an arm or leg, sudden trouble speaking, or sudden loss of balance or vision can be signs of stroke and require rapid emergency assessment.</p><p>Severe chest pain, major breathing difficulty, fainting, or rapidly worsening symptoms also warrant urgent assessment.</p><h2>Act quickly</h2><p>If you think someone may be having a medical emergency, use your local emergency service or go to the nearest appropriate emergency department. Do not rely on an online article to decide whether an emergency is real.</p><p><strong>Important:</strong> This is general safety information, not individualized medical advice.</p>", references: [{ title: "Stroke", url: "https://www.who.int/news-room/fact-sheets/detail/stroke", organization: "World Health Organization" }], status: "published", visibility: "public", isPublished: true, seo: { title: "Warning Signs That Require Urgent Medical Attention | MediCore HMS", description: "General safety guidance on symptoms that may require urgent or emergency assessment." } },
  { slug: "preventive-health-checkups", title: "Preventive Health Checkups: What They Usually Include", excerpt: "Understand how preventive visits can organize risk review, screening discussions, and follow-up without turning a checklist into a diagnosis.", category: "Prevention", tags: ["prevention", "screening", "health checkup"], content: "<p>Preventive care is not one identical test package for everyone. A clinician considers age, health history, family history, symptoms, medicines, and other risk factors when deciding what screening or follow-up is appropriate.</p><h2>What a visit may cover</h2><p>A preventive consultation may include a review of medical history, lifestyle and risk factors, current medicines, vaccinations where relevant, and discussion of age-appropriate screening.</p><h2>Why individualized planning matters</h2><p>More testing is not automatically better. The appropriate plan depends on the person and the clinical question being addressed.</p><p><strong>Important:</strong> Screening recommendations vary by person and country. Use this article as general education and discuss your own needs with a qualified clinician.</p>", references: [{ title: "Primary health care", url: "https://www.who.int/india/health-topics/primary-health-care", organization: "World Health Organization India" }], status: "published", visibility: "public", isPublished: true, seo: { title: "Preventive Health Checkups | MediCore HMS", description: "How preventive consultations can organize health-risk review and appropriate screening discussions." } },
  { slug: "understanding-basic-blood-test-report", title: "Understanding Your Basic Blood Test Report", excerpt: "Learn what common CBC components measure and why an abnormal result should be interpreted in clinical context.", category: "Diagnostics", tags: ["blood tests", "CBC", "diagnostics"], content: "<p>A complete blood count (CBC) measures several parts of the blood, including red blood cells, white blood cells, platelets, hemoglobin, hematocrit, and related indices.</p><h2>What the numbers represent</h2><p>Red-cell measures relate to oxygen-carrying cells and hemoglobin. White-cell measures relate to cells involved in immune responses. Platelets help with blood clotting.</p><h2>Do not read one value in isolation</h2><p>Reference ranges vary by laboratory and patient context. An out-of-range result does not automatically mean that a person has a disease. A clinician interprets the result together with symptoms, history, medicines, and other tests.</p><h2>Preparing for blood tests</h2><p>Some blood tests need fasting or other preparation, while a CBC commonly does not. Follow the specific instructions from the ordering clinician or laboratory.</p><p><strong>Important:</strong> This article explains general concepts and cannot interpret an individual's report.</p>", references: [{ title: "Complete Blood Count (CBC)", url: "https://medlineplus.gov/lab-tests/complete-blood-count-cbc/", organization: "MedlinePlus / U.S. National Library of Medicine" }, { title: "How to Prepare for a Lab Test", url: "https://medlineplus.gov/lab-tests/how-to-prepare-for-a-lab-test/", organization: "MedlinePlus / U.S. National Library of Medicine" }], status: "published", visibility: "public", isPublished: true, seo: { title: "Understanding Your Basic Blood Test Report | MediCore HMS", description: "Educational overview of CBC components, interpretation context, and lab-test preparation." } },
];

const defaultFeatures = [
  { key: "wallet_system", label: "Wallet System", description: "Patient wallet credits and payments", isEnabled: true },
  { key: "subscriptions", label: "Subscriptions", description: "Recurring healthcare packages", isEnabled: true },
  { key: "reviews", label: "Reviews", description: "Doctor and service reviews", isEnabled: true },
  { key: "chat", label: "Chat", description: "Patient-care team messaging", isEnabled: true },
  { key: "ai_features", label: "AI Features", description: "AI summaries and assistance", isEnabled: true },
];

const seed = async () => {
  await connectDB();

  let superAdmin = await User.findOne({ email: adminEmail });
  if (!superAdmin) {
    superAdmin = await User.create({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: "super_admin",
      isActive: true,
    });
  }

  await Promise.all([
    // PHASE 2-D: the "admin" role no longer exists (see constants/roles.js) —
    // no Permission row is seeded for it anymore.
    Permission.findOneAndUpdate(
      { role: "super_admin" },
      { permissions: allPermissions, isSystemRole: true, updatedBy: superAdmin._id },
      { upsert: true, returnDocument: "after" },
    ),
    HospitalSetting.findOneAndUpdate(
      { singletonKey: "global" },
      {
        $setOnInsert: {
          singletonKey: "global",
          hospitalName: "HMS Pro Hospital",
          supportEmail: "support@hmspro.example",
          timezone: "Asia/Kolkata",
          appointmentLimits: { dailyPerDoctor: 30, bookingWindowDays: 30 },
          paymentSettings: { currency: "INR", taxRate: 18, refundsEnabled: true },
        },
      },
      { upsert: true, returnDocument: "after" },
    ),
    ...defaultFeatures.map((feature) =>
      FeatureToggle.findOneAndUpdate({ key: feature.key }, { $setOnInsert: feature }, { upsert: true }),
    ),
    ...defaultServices.map((service) =>
      Service.findOneAndUpdate(
        { slug: service.slug },
        { $setOnInsert: { ...service, createdBy: superAdmin._id, updatedBy: superAdmin._id } },
        { upsert: true, returnDocument: "after" },
      ),
    ),
    ...defaultArticles.map((article) =>
      CMSPage.findOneAndUpdate(
        { slug: article.slug },
        { $setOnInsert: { ...article, contentType: "article", author: superAdmin._id, createdBy: superAdmin._id, updatedBy: superAdmin._id, publishedBy: superAdmin._id, publishedAt: new Date() } },
        { upsert: true, returnDocument: "after" },
      ),
    ),
  ]);

  logger.info("Seed completed", {
    superAdminEmail: adminEmail,
    defaultServices: defaultServices.length,
    defaultArticles: defaultArticles.length,
    defaultFeatures: defaultFeatures.length,
  });
  if (generatedAdminPassword) {
    // Printed once, at the end, so it isn't lost among the earlier
    // per-collection log lines above.
    logger.warn("Generated a random super_admin password for this development run -- set SEED_SUPER_ADMIN_PASSWORD to pin it next time", {
      email: adminEmail,
      password: adminPassword,
    });
  }
};

if (process.argv[1]?.endsWith("seed.js")) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Seed failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

export { seed };
