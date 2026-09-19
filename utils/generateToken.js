import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const generateToken = (user) =>
  jwt.sign(
    {
      userId: user._id.toString(),
      role: user.role,
      // Phase P15 — embedded so authMiddleware can reject tokens issued
      // before the account's most recent password reset.
      securityVersion: user.securityVersion || 0,
    },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn,
    },
  );
