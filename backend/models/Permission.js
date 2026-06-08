import mongoose from "mongoose";
import { ROLE_VALUES } from "../constants/roles.js";

export const PERMISSION_KEYS = Object.freeze([
  "create",
  "edit",
  "delete",
  "manage_payments",
  "manage_doctors",
  "manage_services",
  "manage_cms",
  "manage_settings",
  "export_data",
  "manage_admins",
]);

const permissionSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ROLE_VALUES,
      required: true,
      unique: true,
      index: true,
    },
    permissions: {
      type: Map,
      of: Boolean,
      default: {},
    },
    isSystemRole: {
      type: Boolean,
      default: false,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

const Permission = mongoose.model("Permission", permissionSchema);

export default Permission;
