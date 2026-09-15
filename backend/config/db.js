import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

let listenersRegistered = false;

// BUGFIX (observability/resilience): previously nothing listened for
// connection-level events after the initial connect. A dropped connection
// (network blip, replica set failover, Mongo restart) would go completely
// unlogged -- mongoose queues queries by default while disconnected
// (bufferCommands), so requests would just silently hang with no signal
// in the logs about why. These listeners make connection state changes
// visible and are safe to register once per process.
const registerConnectionListeners = () => {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on("error", (error) => {
    logger.error("MongoDB connection error", { message: error?.message });
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });

  mongoose.connection.on("reconnected", () => {
    logger.info("MongoDB reconnected");
  });
};

export const connectDB = async () => {
  mongoose.set("strictQuery", true);

  registerConnectionListeners();

  const connection = await mongoose.connect(env.mongoUri, {
    autoIndex: !env.isProduction,
    serverSelectionTimeoutMS: 10_000,
  });

  logger.info("MongoDB connected", {
    host: connection.connection.host,
    database: connection.connection.name,
  });

  return connection;
};

export const disconnectDB = async () => {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close();
  logger.info("MongoDB connection closed");
};
