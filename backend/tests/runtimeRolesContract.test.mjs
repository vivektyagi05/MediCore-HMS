import assert from "node:assert/strict";
import fs from "node:fs";

const roles = fs.readFileSync(new URL("../constants/roles.js", import.meta.url), "utf8");
const navigation = fs.readFileSync(new URL("../../src/config/navigation.js", import.meta.url), "utf8");
const sidebar = fs.readFileSync(new URL("../../src/components/layout/Sidebar.jsx", import.meta.url), "utf8");
const userManagement = fs.readFileSync(new URL("../../src/pages/admin/AdminUserManagement.jsx", import.meta.url), "utf8");
const executiveActions = fs.readFileSync(new URL("../../src/pages/admin/AdminExecutiveActionCenter.jsx", import.meta.url), "utf8");

assert.ok(roles.includes('SUPER_ADMIN: "super_admin"'));
assert.ok(roles.includes('DOCTOR: "doctor"'));
assert.ok(roles.includes('PATIENT: "patient"'));
assert.ok(!/\bADMIN\s*:\s*["\']admin["\']/.test(roles));
assert.ok(!roles.includes('RECEPTIONIST: "receptionist"'));

assert.ok(!navigation.includes('roles: ["admin"'));
assert.ok(!navigation.includes(', "admin"]'));
assert.ok(!sidebar.includes('role === "admin"'));
assert.ok(!userManagement.includes('"receptionist"'));
assert.ok(!executiveActions.includes('"receptionist"'));

console.log("runtime roles contract: PASS");
