const formatLog = (level, message, meta = {}) =>
  JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    ...meta,
  });

export const logger = {
  info(message, meta) {
    console.log(formatLog("info", message, meta));
  },
  warn(message, meta) {
    console.warn(formatLog("warn", message, meta));
  },
  error(message, meta) {
    console.error(formatLog("error", message, meta));
  },
};

export const requestLogger = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    logger.info("HTTP request", {
      method: req.method,
      route: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
    });
  });

  next();
};
