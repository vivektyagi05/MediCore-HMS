// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.3 — Enterprise Automation Studio.
// Condition Builder (brief Step 4) — evaluator half. The visual builder
// itself lives in the frontend (AdminAutomationStudio.jsx); this is the
// pure function both the real event runner AND the Execution Simulator
// call, so a dry run and a live run can never disagree about whether a
// condition matched.
//
// A condition tree is either:
//   - a leaf rule: { field, operator, value, valueTo? }
//   - a group: { logic: "AND" | "OR", rules: [ <rule-or-group>, ... ] }
//   - null/undefined/empty group -> always matches (no condition set)
// ─────────────────────────────────────────────────────────────────────────

function getByPath(obj, path) {
  if (!path) return undefined;
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function evaluateRule(rule, context) {
  const actual = getByPath(context, rule.field);
  const expected = rule.value;

  switch (rule.operator) {
    case "equals":
      return String(actual) === String(expected);
    case "not_equals":
      return String(actual) !== String(expected);
    case "contains":
      return actual != null && String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case "starts_with":
      return actual != null && String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
    case "ends_with":
      return actual != null && String(actual).toLowerCase().endsWith(String(expected).toLowerCase());
    case "greater_than":
      return Number(actual) > Number(expected);
    case "less_than":
      return Number(actual) < Number(expected);
    case "between": {
      const num = Number(actual);
      return num >= Number(expected) && num <= Number(rule.valueTo);
    }
    case "empty":
      return actual === undefined || actual === null || actual === "";
    case "not_empty":
      return actual !== undefined && actual !== null && actual !== "";
    default:
      return false;
  }
}

function isGroup(node) {
  return node && typeof node === "object" && Array.isArray(node.rules);
}

export function evaluateConditionNode(node, context) {
  if (!node) return true; // no condition set -> always matches
  if (isGroup(node)) {
    if (!node.rules.length) return true;
    const results = node.rules.map((child) => evaluateConditionNode(child, context));
    return node.logic === "OR" ? results.some(Boolean) : results.every(Boolean); // default AND
  }
  if (!node.field || !node.operator) return true; // malformed leaf — never block a flow, just don't filter on it
  return evaluateRule(node, context);
}

/**
 * Returns { matched, trace } — trace is a flat, human-readable list of
 * every leaf rule evaluated and its result, used by the Execution
 * Simulator's "Step Results" panel so admins can see exactly which
 * condition passed or failed, not just the final boolean.
 */
export function evaluateConditions(conditionTree, context) {
  const trace = [];
  function walk(node) {
    if (!node) return true;
    if (isGroup(node)) {
      const childResults = node.rules.map(walk);
      const groupResult = node.rules.length === 0 ? true : node.logic === "OR" ? childResults.some(Boolean) : childResults.every(Boolean);
      return groupResult;
    }
    if (!node.field || !node.operator) return true;
    const result = evaluateRule(node, context);
    trace.push({ field: node.field, operator: node.operator, value: node.value, valueTo: node.valueTo, result });
    return result;
  }
  const matched = walk(conditionTree);
  return { matched, trace };
}
