import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const mustContain = (file, text) => {
  const content = read(file);
  if (!content.includes(text)) throw new Error(`${file}: missing ${text}`);
};

const route = read("src/routes/AppRoutes.jsx");
for (const expected of [
  '/privacy-policy', '/terms', '/medical-disclaimer', '/cookie-policy',
  '/privacy-preferences', '/data-rights',
]) {
  if (!route.includes(`path="${expected}"`)) throw new Error(`Missing legal route ${expected}`);
}

for (const file of [
  "src/components/legal/LegalDocumentPage.jsx",
  "src/pages/public/PrivacyPreferences.jsx",
  "src/pages/public/DataRights.jsx",
  "src/i18n/locales/p16.en.js",
  "backend/models/PrivacyRequest.js",
  "backend/models/ConsentRecord.js",
  "backend/models/PrivacyPreference.js",
  "backend/controllers/privacyController.js",
  "backend/routes/privacyRoutes.js",
  "shared/legalDocuments.js",
]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}

mustContain("backend/app.js", 'app.use("/api/privacy", privacyRoutes);');
mustContain("backend/routes/privacyRoutes.js", 'protect');
mustContain("backend/controllers/privacyController.js", 'req.user._id');
mustContain("backend/controllers/privacyController.js", 'currentPassword');
mustContain("backend/controllers/privacyController.js", 'Password');
mustContain("backend/controllers/privacyController.js", 'exportPrivacyData');
mustContain("backend/controllers/privacyController.js", 'mapMedicalReportExport');
mustContain("backend/controllers/privacyController.js", 'mapPrescriptionExport');
mustContain("backend/controllers/privacyController.js", 'mapMedicalNoteExport');
mustContain("backend/controllers/privacyController.js", 'Content-Disposition');
mustContain("backend/controllers/privacyController.js", 'Cache-Control');
mustContain("backend/controllers/privacyController.js", 'logger.info("Privacy request created"');
mustContain("src/pages/public/DataRights.jsx", 'privacyApi.createRequest');
mustContain("src/pages/public/DataRights.jsx", 'privacyApi.exportData');
mustContain("src/pages/public/DataRights.jsx", 'privacyApi.submitGrievance');
if (read("src/components/legal/LegalDocumentPage.jsx").includes("dangerouslySetInnerHTML")) throw new Error("Legal content must not use dangerouslySetInnerHTML");
mustContain("src/layout/MainLayout.jsx", 'to="/privacy-policy"');
mustContain("src/layout/MainLayout.jsx", 'to="/data-rights"');
mustContain("backend/.env.example", 'PRIVACY_CONTACT_EMAIL=');
mustContain("backend/.env.example", 'GRIEVANCE_CONTACT_EMAIL=');
mustContain("backend/.env.example", 'LEGAL_CONTACT_EMAIL=');
mustContain("src/pages/auth/Register.jsx", 'to="/terms"');
mustContain("src/pages/auth/Register.jsx", 'to="/privacy-policy"');
mustContain("src/pages/patient/BookAppointment.jsx", 'to="/medical-disclaimer"');

for (const file of ["src/pages/public/PrivacyPreferences.jsx", "src/pages/public/DataRights.jsx"]) {
  const content = read(file);
  if (content.includes("fake") || content.includes("mock")) throw new Error(`${file}: fake/mock flow marker found`);
}

console.log("P16 contract validation: PASS");
