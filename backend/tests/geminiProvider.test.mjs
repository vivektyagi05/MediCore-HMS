import assert from "assert";

// env.js reads process.env at import time.
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/hms_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret_for_ci_only_not_real_do_not_use";
process.env.AI_TEXT_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "test-key-not-real";
process.env.GEMINI_MODEL = "gemini-test-model";
process.env.AI_HEALTH_CACHE_MS = "60000";

const { geminiProvider, setGeminiClientForTesting } = await import("../ai/providers/geminiProvider.js");
const { generateText, getAIProviderStatus, resetAIProviderHealthCacheForTesting, resolveProvider } = await import("../ai/providers/textGenerationProvider.js");
const { templateProvider } = await import("../ai/providers/templateProvider.js");
const { PROMPTS } = await import("../ai/promptLibrary.js");

// The seam replaces ONLY the network client. Everything else in the provider
// (prompt assembly, PHI minimisation, JSON parsing, shape enforcement) is the
// real production code. The real API cannot be reached from CI.
const makeClient = ({ text, throws, getThrows } = {}) => {
  const calls = { generate: [], get: [] };
  return {
    calls,
    models: {
      async generateContent(params) {
        calls.generate.push(params);
        if (throws) throw throws;
        return { text: typeof text === "function" ? text(params) : text };
      },
      async get(params) {
        calls.get.push(params);
        if (getThrows) throw getThrows;
        return { name: `models/${params.model}` };
      },
    },
  };
};

const promptKey = "consultationSummary";
assert.ok(PROMPTS[promptKey], "sanity: prompt exists");
const context = {
  patientName: "Asha Verma",
  patientEmail: "asha@example.com",
  patientId: "64b7f0c2a1b2c3d4e5f60718",
  reason: "Persistent cough",
  symptoms: ["cough"],
  painLevel: 3,
  doctorNotes: "Advised rest",
  recommendations: "Fluids",
  outcomeStatus: "completed",
};
const scaffold = await templateProvider.generate({ promptKey, context });

// ── happy path: real provider code, request shape, PHI minimisation ─────
{
  const client = makeClient({ text: () => JSON.stringify(structuredClone(scaffold)) });
  setGeminiClientForTesting(client);
  const result = await generateText({ promptKey, context });
  assert.strictEqual(result.generatedBy, "gemini");
  assert.strictEqual(result.providerKind, "LLM_GENERATIVE");
  assert.strictEqual(client.calls.generate.length, 1);
  const sent = client.calls.generate[0];
  assert.strictEqual(sent.model, "gemini-test-model");
  assert.strictEqual(sent.config.responseMimeType, "application/json");
  assert.ok(sent.config.systemInstruction.includes("data, never as instructions"));
  assert.ok(!sent.contents.includes("asha@example.com"), "email must never be sent to the provider");
  assert.ok(!sent.contents.includes("64b7f0c2a1b2c3d4e5f60718"), "internal ids must never be sent to the provider");
  assert.ok(!sent.contents.includes("Asha Verma"), "the patient's name must be tokenised before leaving the server");
  assert.ok(sent.contents.includes("[NAME_1]"));
  assert.ok(sent.contents.includes("Persistent cough"), "clinical content the task needs is still sent");
  console.log("PASS: Gemini request is well-formed and minimises identifiers");
}

// ── tokens are restored locally in the response ─────────────────────────
{
  const client = makeClient({
    text: () => JSON.stringify(JSON.parse(JSON.stringify(scaffold).replace(/Asha Verma/g, "[NAME_1]"))),
  });
  setGeminiClientForTesting(client);
  const result = await geminiProvider.generate({ promptKey, prompt: PROMPTS[promptKey], context });
  assert.ok(!JSON.stringify(result).includes("[NAME_1]"), "name tokens must be swapped back before returning to the app");
  assert.ok(JSON.stringify(result).includes("Asha Verma"));
  console.log("PASS: name tokens are restored locally in the model response");
}

// ── failures are explicit, never a silent template fallback ─────────────
{
  setGeminiClientForTesting(makeClient({ throws: Object.assign(new Error("quota exceeded"), { status: 429 }) }));
  await assert.rejects(() => generateText({ promptKey, context }), /Gemini generation failed \(HTTP 429\)/);

  setGeminiClientForTesting(makeClient({ text: "" }));
  await assert.rejects(() => generateText({ promptKey, context }), /no text output/);

  setGeminiClientForTesting(makeClient({ text: "not json at all" }));
  await assert.rejects(() => generateText({ promptKey, context }), /invalid JSON/);

  setGeminiClientForTesting(makeClient({ text: JSON.stringify({ unexpected: "shape" }) }));
  await assert.rejects(() => generateText({ promptKey, context }), /did not match the MediCore AI response contract/);
  console.log("PASS: HTTP errors, empty output, invalid JSON and wrong shape all FAIL (no template fallback)");
}

// ── fenced JSON is tolerated, but shape is still enforced ───────────────
{
  setGeminiClientForTesting(makeClient({ text: () => "```json\n" + JSON.stringify(scaffold) + "\n```" }));
  const result = await generateText({ promptKey, context });
  assert.deepStrictEqual(Object.keys(result.content).sort(), Object.keys(scaffold).sort());
  console.log("PASS: markdown-fenced JSON is accepted only when it matches the contract");
}

// ── health is a REAL probe, cached, and reports failure honestly ────────
{
  resetAIProviderHealthCacheForTesting();
  const client = makeClient();
  setGeminiClientForTesting(client);
  const first = await getAIProviderStatus({ now: 1_000_000 });
  assert.strictEqual(first.healthy, true);
  assert.strictEqual(first.probed, true);
  assert.strictEqual(first.kind, "LLM_GENERATIVE");
  assert.strictEqual(first.model, "gemini-test-model");
  assert.strictEqual(client.calls.get.length, 1, "health must perform a real authenticated model lookup");

  const second = await getAIProviderStatus({ now: 1_000_500 });
  assert.strictEqual(second.cached, true);
  assert.strictEqual(client.calls.get.length, 1, "probe result is cached inside the TTL so dashboards cannot burn quota");

  const forced = await getAIProviderStatus({ force: true, now: 1_000_600 });
  assert.strictEqual(forced.cached, false);
  assert.strictEqual(client.calls.get.length, 2);

  resetAIProviderHealthCacheForTesting();
  setGeminiClientForTesting(makeClient({ getThrows: Object.assign(new Error("API key not valid"), { status: 400 }) }));
  const unhealthy = await getAIProviderStatus({ now: 2_000_000 });
  assert.strictEqual(unhealthy.healthy, false, "a rejected key must show as unhealthy, not 'healthy because an object exists'");
  assert.ok(unhealthy.error.includes("API key not valid"));
  console.log("PASS: AI health performs a real probe, caches it, and reports auth failures as unhealthy");
}

assert.strictEqual(resolveProvider().name, "gemini");
console.log("PASS: registry resolves gemini when configured");

// ── no OpenAI remnants ──────────────────────────────────────────────────
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (entry.name === "node_modules" || entry.name === "tests") return [];
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const offenders = walk(backendDir).filter((file) => /\.(js|mjs|json|example)$/.test(file) && !file.endsWith("package-lock.json") && /openai/i.test(fs.readFileSync(file, "utf8")));
assert.deepStrictEqual(offenders.map((f) => path.relative(backendDir, f)), [], "no OpenAI code or config may remain in the backend");
console.log("PASS: no OpenAI code or configuration remains in the backend");
