import { Router } from "express";
import {
  getCities,
  getDistricts,
  getSpecializations,
  getStates,
} from "../controllers/masterDataController.js";

const router = Router();

router.get("/specializations", getSpecializations);
router.get("/states", getStates);
router.get("/districts", getDistricts);
router.get("/cities", getCities);

export default router;
