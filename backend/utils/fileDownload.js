import fs from "fs";
import { AppError } from "../middleware/errorMiddleware.js";

// Extracted from patientWorkflowController.js (PHASE UI-4 audit) so the new
// admin-side patient report/prescription download endpoints reuse the exact
// same existence-check + res.download() behavior instead of re-implementing
// it. Not a behavior change for any existing caller.
export const downloadFile = (res, filePath, fileName) => {
  if (!filePath || !fs.existsSync(filePath)) throw new AppError("File not found", 404);
  res.download(filePath, fileName);
};
