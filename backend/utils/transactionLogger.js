import { logger } from "./logger.js";

export const transactionLogger = {
  payment(message, meta = {}) {
    logger.info(message, {
      domain: "financial",
      eventType: "payment",
      ...meta,
    });
  },
  refund(message, meta = {}) {
    logger.info(message, {
      domain: "financial",
      eventType: "refund",
      ...meta,
    });
  },
  error(message, meta = {}) {
    logger.error(message, {
      domain: "financial",
      ...meta,
    });
  },
};
