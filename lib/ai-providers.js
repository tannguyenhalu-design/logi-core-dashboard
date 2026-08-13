/**
 * lib/ai-providers.js
 * Unified AI Provider Manager cho Tiểu Đệ SD3
 *
 * Priority chain (tất cả MIỄN PHÍ):
 * 1. Gemini 2.5 Flash      — Google, 1500 req/day, thông minh nhất, 1M context
 * 2. Groq Llama 3.3 70B    — Groq, 14400 req/day, cực NHANH (~500 tok/s)
 * 3. Gemini 2.5 Flash Backup — Google, backup chắc chắn
 * 4. Groq Gemma 2 9B       — Groq, nhẹ hơn, last resort
 * 5. Gemini 2.5 Flash Lite — Google, lightest
 */

import { GoogleGenAI } from "@google/genai";

// ─── Gemini client ─────────────────────────────────────────────────────────────
let _geminiClient = null;
function getGeminiClient() {
  if (!_geminiClient) {
    if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
    _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _geminiClient;
}

// ─── Groq client (OpenAI-compatible REST, no extra package needed) ─────────────
async function callGroq({ model, systemPrompt, userPrompt, temperature = 0.2 }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY");

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature,
      max_tokens: 1024,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Groq ${model} error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const json = await resp.json();
  return (json.choices?.[0]?.message?.content || "").trim();
}

// ─── Gemini call wrapper ───────────────────────────────────────────────────────
async function callGemini({ model, systemPrompt, userPrompt, temperature = 0.2 }) {
  const ai = getGeminiClient();
  const resp = await ai.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      temperature,
    },
  });
  return (resp.text || "").trim();
}

// ─── Provider chain definition ─────────────────────────────────────────────────
const PROVIDERS = [
  {
    name: "Gemini 2.5 Flash",
    call: (args) => callGemini({ ...args, model: "gemini-2.5-flash" }),
    type: "gemini",
  },
  {
    name: "Groq Llama 3.3 70B",
    call: (args) => callGroq({ ...args, model: "llama-3.3-70b-versatile" }),
    type: "groq",
    requiresKey: "GROQ_API_KEY",
  },
  {
    name: "Gemini 2.5 Flash Backup",
    call: (args) => callGemini({ ...args, model: "gemini-2.5-flash" }),
    type: "gemini",
  },
  {
    name: "Groq Gemma 2 9B",
    call: (args) => callGroq({ ...args, model: "gemma2-9b-it" }),
    type: "groq",
    requiresKey: "GROQ_API_KEY",
  },
  {
    name: "Gemini 2.5 Flash Lite",
    call: (args) => callGemini({ ...args, model: "gemini-2.5-flash" }),
    type: "gemini",
  },
];

// ─── Main: generate with auto-fallback ────────────────────────────────────────
/**
 * generateWithFallback — tries each provider in order until one succeeds.
 * @param {Object} args
 * @param {string} args.systemPrompt
 * @param {string} args.userPrompt
 * @param {number} [args.temperature]
 * @returns {Promise<{ text: string, provider: string }>}
 */
export async function generateWithFallback({ systemPrompt, userPrompt, temperature = 0.2 }) {
  const errors = [];

  for (const provider of PROVIDERS) {
    // Skip Groq providers if no key
    if (provider.requiresKey && !process.env[provider.requiresKey]) {
      continue;
    }
    try {
      const text = await provider.call({ systemPrompt, userPrompt, temperature });
      if (text) {
        if (errors.length > 0) {
          console.info(`[ai-providers] Succeeded with ${provider.name} after ${errors.length} failure(s)`);
        }
        return { text, provider: provider.name };
      }
    } catch (err) {
      console.warn(`[ai-providers] ${provider.name} failed:`, err.message);
      errors.push(`${provider.name}: ${err.message}`);
    }
  }

  throw new Error("Tất cả AI providers đều thất bại:\n" + errors.join("\n"));
}

/**
 * generateFast — uses Groq first (fastest) then Gemini fallback.
 * Good for short/simple tasks like insight extraction.
 */
export async function generateFast({ systemPrompt, userPrompt, temperature = 0.1 }) {
  const fastProviders = [
    {
      name: "Groq Llama 3.3 70B",
      call: () => callGroq({ model: "llama-3.3-70b-versatile", systemPrompt, userPrompt, temperature }),
      requiresKey: "GROQ_API_KEY",
    },
    {
      name: "Gemini 2.5 Flash Lite",
      call: () => callGemini({ model: "gemini-2.5-flash", systemPrompt, userPrompt, temperature }),
    },
    {
      name: "Gemini 2.5 Flash",
      call: () => callGemini({ model: "gemini-2.5-flash", systemPrompt, userPrompt, temperature }),
    },
  ];

  for (const p of fastProviders) {
    if (p.requiresKey && !process.env[p.requiresKey]) continue;
    try {
      const text = await p.call();
      if (text) return { text, provider: p.name };
    } catch (err) {
      console.warn(`[ai-providers:fast] ${p.name} failed:`, err.message);
    }
  }
  throw new Error("generateFast: all providers failed");
}

// Export Gemini client for legacy callers
export { getGeminiClient };
