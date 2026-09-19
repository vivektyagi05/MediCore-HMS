import { env } from "../../config/env.js";
import { templateProvider } from "./templateProvider.js";

const ENDPOINT = "https://api.openai.com/v1/responses";

const shapeOf = (value) => {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, shapeOf(nested)]));
  }
  if (value === null) return "null";
  return typeof value;
};

const sameShape = (value, shape) => {
  if (shape === "null") return value === null;
  if (shape === "string" || shape === "number" || shape === "boolean") return typeof value === shape;
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return false;
    return shape.length === 0 || value.every((item) => sameShape(item, shape[0]));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const shapeKeys = Object.keys(shape).sort();
  const valueKeys = Object.keys(value).sort();
  if (shapeKeys.join("\u0000") !== valueKeys.join("\u0000")) return false;
  return shapeKeys.every((key) => sameShape(value[key], shape[key]));
};

const extractOutputText = (data) => {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
};

export const openaiProvider = {
  name: "openai-responses",

  async generate({ promptKey, prompt, context }) {
    if (!env.ai.openaiApiKey) throw new Error("OPENAI_API_KEY is not configured");

    // The existing deterministic renderer defines the exact response shape
    // consumed by the frontend. We use it only as a schema/example generator,
    // never as a fallback result. If the real model cannot honor that shape,
    // the request fails instead of silently returning fake/template content.
    const scaffold = await templateProvider.generate({ promptKey, context });
    const schemaShape = shapeOf(scaffold);

    const instructions = [
      "You are the real AI generation layer for MediCore HMS.",
      "Follow the supplied task instructions exactly.",
      "Use ONLY the supplied structured source context. Never invent a patient fact, clinical finding, number, date, payment state, diagnosis, or operational metric.",
      "If the source context does not contain enough information, explicitly state that the information is unavailable rather than guessing.",
      "Return ONLY valid JSON. The JSON must have exactly the same keys and value types as the provided expected shape.",
      `Prompt key: ${promptKey}`,
      `Task instructions: ${prompt.instructions}`,
      `Expected JSON shape: ${JSON.stringify(schemaShape)}`,
      `Source context: ${JSON.stringify(context ?? {})}`,
    ].join("\n\n");

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ai.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.ai.openaiModel,
        instructions,
        input: "Generate the grounded JSON now.",
      }),
      signal: AbortSignal.timeout(env.ai.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI generation failed with HTTP ${response.status}${body ? `: ${body.slice(0, 400)}` : ""}`);
    }

    const data = await response.json();
    const text = extractOutputText(data);
    if (!text) throw new Error("OpenAI returned no text output");

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("OpenAI returned invalid JSON for the MediCore AI response contract");
    }

    if (!sameShape(parsed, schemaShape)) {
      throw new Error("OpenAI response did not match the MediCore AI response contract");
    }

    return parsed;
  },
};
