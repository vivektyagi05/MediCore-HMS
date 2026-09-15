import { Router } from "express";

import {
getUsers,
getUserById,
updateUser,
deleteUser,
toggleUserStatus,
} from "../../controllers/admin/userAdminController.js";

import { protect } from "../../middleware/authMiddleware.js";
import { authorizeRoles } from "../../middleware/roleMiddleware.js";

import { ROLES } from "../../constants/roles.js";

const router = Router();

router.use(
protect,
authorizeRoles(
ROLES.ADMIN,
ROLES.SUPER_ADMIN
)
);

router.get("/", getUsers);

router.get(
"/:id",
getUserById
);

router.put(
"/:id",
updateUser
);

router.delete(
"/:id",
deleteUser
);

router.patch(
"/:id/status",
toggleUserStatus
);

export default router;
