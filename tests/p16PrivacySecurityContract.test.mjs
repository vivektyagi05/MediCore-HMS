import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const controller = read("backend/controllers/privacyController.js");
const dataRights = read("src/pages/public/DataRights.jsx");
const legal = read("src/components/legal/LegalDocumentPage.jsx");

const required = [
  "const userId = req.user._id;",
  "mapUserExport(user)",
  "mapMedicalReportExport",
  "mapPrescriptionExport",
  "mapMedicalNoteExport",
  "mapConsultationHistoryExport",
  "mapFamilyMemberExport",
  "mapWalletExport",
  "mapLedgerExport",
  "mapSymptomSessionExport",
  "mapCertificateExport",
  '"Content-Type": "application/json; charset=utf-8"',
  '"Content-Disposition"',
  '"Cache-Control": "no-store"',
];
for (const value of required) {
  if (!controller.includes(value)) throw new Error(`privacyController missing ${value}`);
}

for (const forbidden of [
  "cleanDocument(",
  ".lean()).map(cleanDocument)",
  "User.findById(userId).lean()",
]) {
  if (controller.includes(forbidden)) throw new Error(`unsafe raw export pattern: ${forbidden}`);
}

for (const forbidden of [
  "Your request is bound to this signed-in account",
  "Privacy contact:",
  "Grievance contact:",
  ">Privacy Policy<",
  ">Cookie Policy<",
  ">Privacy Preferences<",
]) {
  if (dataRights.includes(forbidden)) throw new Error(`hardcoded Phase-16 UI string: ${forbidden}`);
}

if (!legal.includes('import SEOMeta from "../shared/SEOMeta";')) {
  throw new Error("LegalDocumentPage does not use shared SEOMeta");
}
if (legal.includes('import SEOMeta from "./SEOMeta";')) {
  throw new Error("LegalDocumentPage still contains wrong SEOMeta import");
}
if (!legal.includes('if (!meta || !base || !Array.isArray(sectionKeys))')) {
  throw new Error("LegalDocumentPage missing invalid documentKey guard");
}
console.log("P16 privacy/security contract: PASS");
