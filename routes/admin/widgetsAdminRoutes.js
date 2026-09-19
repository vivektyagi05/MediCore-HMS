import { Router } from "express";
import { getWidgetRegistry, getWidgetData } from "../../controllers/admin/widgetsAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Per-widget permission is enforced inside getWidgetData/getWidgetRegistry
// (see widgetsAdminController.js) because it varies per widget key — a
// single static middleware can't express that, so the registry itself
// carries each widget's required permission and userHasPermission() is
// checked against it directly.
router.get("/registry", getWidgetRegistry);
router.get("/:key", getWidgetData);

export default router;
