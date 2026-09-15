// Swappable text-generation provider layer.
//
// Every generative AI feature calls `generateText({ promptKey, context })`
// from this module instead of talking to any specific vendor. Today the
// only implementation is a deterministic, template-based renderer — it
// never calls the network, so it works with zero configuration and can
// never hallucinate data that wasn't in `context`.
//
// To swap in a real LLM later: implement `generate({ promptKey, context,
// instructions })` returning a string, register it in `PROVIDERS`, and set
// AI_TEXT_PROVIDER in the environment. No calling code changes.

import { getPrompt } from "../promptLibrary.js";
import { templateProvider } from "./templateProvider.js";

const PROVIDERS = {
  template: templateProvider,
  // openai: openaiProvider,       // future: implement and register
  // anthropic: anthropicProvider, // future: implement and register
};

function resolveProvider() {
  const key = process.env.AI_TEXT_PROVIDER || "template";
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(
      `AI_TEXT_PROVIDER "${key}" is not registered. Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return provider;
}

/**
 * @param {string} promptKey - key into promptLibrary.PROMPTS
 * @param {object} context - structured, already-fetched platform data (never fabricated)
 * @returns {Promise<{ content: string|object, generatedBy: string }>}
 */
export async function generateText({ promptKey, context }) {
  const prompt = getPrompt(promptKey);
  const provider = resolveProvider();
  const content = await provider.generate({ promptKey, prompt, context });
  return { content, generatedBy: provider.name };
}

// Phase A5.2 — Platform Health Center: lets the health center report which
// AI provider is actually active and whether it resolves, without running
// a real generation. Reuses the exact same resolveProvider() every real
// request already goes through — no separate/duplicated resolution logic.
export function getAIProviderStatus() {
  const configuredKey = process.env.AI_TEXT_PROVIDER || "template";
  try {
    const provider = resolveProvider();
    return { healthy: true, activeProvider: provider.name, configuredKey };
  } catch (error) {
    return { healthy: false, activeProvider: null, configuredKey, error: error.message };
  }
}
