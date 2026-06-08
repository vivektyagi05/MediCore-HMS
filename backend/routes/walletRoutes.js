import { Router } from "express";
import { getWallet } from "../controllers/walletController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = Router();

router.get("/", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), getWallet);

export default router;
