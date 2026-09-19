export const normalizeMasterText = (value) => String(value ?? "").trim();

export const validateOtherValue = (value, maxLength, field) => {
  const text = normalizeMasterText(value);
  if (!text) throw new Error(`${field} otherValue is required`);
  if (text.length > maxLength) throw new Error(`${field} otherValue is too long`);
  return text;
};

export const assertMasterParent = (childParentId, expectedParentId, label) => {
  if (!childParentId || !expectedParentId || String(childParentId) !== String(expectedParentId)) {
    throw new Error(`${label} does not belong to the selected parent`);
  }
  return true;
};
