import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { listMasterData, MASTER_KINDS } from "../services/masterDataService.js";

const list = (kind) => asyncHandler(async (req, res) => {
  const parentId = req.query.parent;
  const data = await listMasterData({ kind, ...(parentId !== undefined ? { parentId } : {}) });
  res.status(200).json({ success: true, data, message: `${kind} master data fetched successfully` });
});

export const getSpecializations = list(MASTER_KINDS.SPECIALIZATION);
export const getStates = list(MASTER_KINDS.STATE);
export const getDistricts = list(MASTER_KINDS.DISTRICT);
export const getCities = list(MASTER_KINDS.CITY);
