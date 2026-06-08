import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";
import { AppError } from "./errorMiddleware.js";
import { asyncHandler } from "./asyncHandler.js";

export const protect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError("Authentication token is required", 401);
  }

  const token = authHeader.split(" ")[1];

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError("Invalid or expired authentication token", 401);
  }

  const user = await User.findById(payload.userId).select("-password");

  if (!user || !user.isActive) {
    throw new AppError("Authenticated user is no longer active", 401);
  }

  req.user = user;
  next();
});
