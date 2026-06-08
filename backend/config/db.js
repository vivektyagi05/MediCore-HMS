import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

export const connectDB = async () => {
  mongoose.set("strictQuery", true);

  const connection = await mongoose.connect(env.mongoUri, {
    autoIndex: !env.isProduction,
  });

  logger.info("MongoDB connected", {
    host: connection.connection.host,
    database: connection.connection.name,
  });

  return connection;
};
