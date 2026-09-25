// Text-generation provider registry (the AIProvider seam).
//
// Provider interface:
//   { name: string,
//     kind: "LLM_GENERATIVE" | "TEMPLATE",
//     generate({ promptKey, prompt, context }): Promise<object>,
//     checkHealth?(): Promise<object> }         // real availability probe
//
// Registered providers:
//   gemini   -> LLM_GENERATIVE  (production; native @google/genai SDK)
//   template -> TEMPLATE        (development/test only; rejected in production)
//
// Every generative feature calls generateText({ promptKey, context }); no
// caller talks to a vendor directly. Production boot is guarded in
// config/productionGuards.js; resolveProvider() repeats the template check as
// a second, independent layer so a misconfigured process can never serve
// template text as if it were model output.
import { env } from "../../config/env.js";
import { getPrompt } from "../promptLibrary.js";
import { templateProvider } from "./templateProvider.js";
import { geminiProvider } from "./geminiProvider.js";

export const PROVIDER_KINDS = Object.freeze({
  LLM_GENERATIVE: "LLM_GENERATIVE",
  TEMPLATE: "TEMPLATE",
});

const PROVIDERS = {
  template: templateProvider,
  gemini: geminiProvider,
};

export function resolveProvider() {
  const key = env.ai.provider;
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`AI_TEXT_PROVIDER "${key}" is not registered. Available: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  if (env.isProduction && provider.kind !== PROVIDER_KINDS.LLM_GENERATIVE) {
    throw new Error(`AI provider "${key}" is not a generative provider and is not allowed in production`);
  }
  return provider;
}

/**
 * @param {string} promptKey - key into promptLibrary.PROMPTS
 * @param {object} context - structured, already-fetched, already-authorised platform data
 * @returns {Promise<{ content: object, generatedBy: string, providerKind: string }>}
 */
export async function generateText({ promptKey, context }) {
  const prompt = getPrompt(promptKey);
  const provider = resolveProvider();
  const content = await provider.generate({ promptKey, prompt, context });
  return { content, generatedBy: provider.name, providerKind: provider.kind };
}

// ── Health ───────────────────────────────────────────────────────────────
// "Healthy" means a real, recent, successful probe of the provider -- not
// merely that a provider object could be constructed. Probe results are
// cached briefly so dashboards polling this endpoint cannot burn quota.
let lastProbe = null; // { at:number, key:string, result:object }

export function resetAIProviderHealthCacheForTesting() {
  lastProbe = null;
}

export async function getAIProviderStatus({ force = false, now = Date.now() } = {}) {
  const configuredKey = env.ai.provider;

  let provider;
  try {
    provider = resolveProvider();
  } catch (error) {
    return { healthy: false, configured: false, activeProvider: null, kind: null, configuredKey, error: error.message, checkedAt: new Date(now).toISOString() };
  }

  const base = { configured: true, activeProvider: provider.name, kind: provider.kind, configuredKey, model: provider.model || null };

  if (typeof provider.checkHealth !== "function") {
    // TEMPLATE has nothing external to probe. It is "available" but is reported
    // with its real kind so no UI can present it as a language model.
    return { ...base, healthy: true, probed: false, checkedAt: new Date(now).toISOString() };
  }

  if (!force && lastProbe && lastProbe.key === configuredKey && now - lastProbe.at < env.ai.healthCacheMs) {
    return { ...base, ...lastProbe.result, cached: true };
  }

  let result;
  try {
    const detail = await provider.checkHealth();
    result = { healthy: true, probed: true, detail, checkedAt: new Date(now).toISOString() };
  } catch (error) {
    result = { healthy: false, probed: true, error: String(error?.message || error).slice(0, 300), checkedAt: new Date(now).toISOString() };
  }
  lastProbe = { at: now, key: configuredKey, result };
  return { ...base, ...result, cached: false };
}
