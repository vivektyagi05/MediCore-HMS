const getValidationMessage = (error) => {
  const details = error?.response?.data?.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const messages = Object.values(details).filter((value) => typeof value === "string");
    if (messages.length) return messages.join(" ");
  }
  return "";
};

const serverMessage = (error) => {
  const message = error?.response?.data?.message;
  return typeof message === "string" && message.trim() ? message : "";
};

export const getAuthErrorMessage = (error, t, mode) => {
  if (error?.code === "ECONNABORTED") {
    return t("p14.login.networkError");
  }

  if (!error?.response) {
    return t("p14.login.networkError");
  }

  const status = error.response.status;
  const validationMessage = getValidationMessage(error);
  if (validationMessage) return validationMessage;

  if (status === 429) {
    return "Too many requests. Please wait and try again.";
  }

  if (mode === "login") {
    if (status === 401) return t("p14.errors.loginFailed");
    if (status === 503) return "MediCore is temporarily unavailable. Please try again later.";
  }

  if (mode === "register") {
    if (status === 409) return serverMessage(error) || "An account with this email already exists.";
    if (status === 503) return serverMessage(error) || "New registrations are temporarily unavailable. Please try again later.";
  }

  if (status === 404) return "MediCore could not find the requested service.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 500) return "MediCore could not complete the request. Please try again.";
  if (status === 503) return serverMessage(error) || "MediCore is temporarily unavailable. Please try again later.";

  return serverMessage(error) || (mode === "register"
    ? t("p14.errors.registrationFailed")
    : t("p14.errors.loginFailed"));
};
