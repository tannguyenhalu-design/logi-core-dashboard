/**
 * lib/ai-providers.js
 * Unified AI Provider Manager cho Tiểu Đệ SD3
 *
 * Priority chain (tất cả MIỄN PHÍ):
 * 1. Groq gpt-oss-120b   — Groq, cực NHANH (~500 tok/s)
 * 2. Gemini 2.5 Flash    — Google, thông minh nhất, 1M context
 * 3. Groq gpt-oss-20b    — Groq, nhẹ hơn, backup
 * 4. Gemini 2.5 Flash Lite — Google, quota RIÊNG với 2.5 Flash (model khác
 *    hẳn, không phải trùng tên) — thực sự là lớp dự phòng thứ 2, không ăn
 *    chung quota với #2.
 *
 * Lịch sử: bản trước dùng "llama-3.3-70b-versatile" và "gemma2-9b-it" —
 * Groq deprecated/decommission cả 2 model này (xác nhận qua log lỗi thật
 * trên production 2026-08-22: mọi request Groq đều fail 404/400, ÂM THẦM
 * rơi hết xuống Gemini). Đồng thời cả 3 "Gemini" entry trước đó đều
 * hardcode CÙNG 1 model "gemini-2.5-flash" dù tên khác nhau ("Backup"/
 * "Lite") — tưởng là 3 lớp dự phòng độc lập nhưng thực chất dùng chung 1
 * quota bucket (giới hạn 20 req/ngày trên project này), nên chỉ cần vượt
 * quota là TẤT CẢ "3 lớp Gemini" fail cùng lúc. 2 vấn đề cộng lại là lý do
 * chính khiến bot im lặng/trả lời hóc búa trước đây.
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
// Groq goes first — observed materially faster than Gemini Flash in
// production (this ordering used to put Gemini first, contributing to
// 10-15s+ end-to-end chat latency that risked hitting the serverless
// function timeout with no reply at all). Gemini stays as the fallback
// chain for when Groq is rate-limited or down.
const PROVIDERS = [
  {
    name: "Groq gpt-oss-120b",
    call: (args) => callGroq({ ...args, model: "openai/gpt-oss-120b" }),
    type: "groq",
    requiresKey: "GROQ_API_KEY",
  },
  {
    name: "Gemini 2.5 Flash",
    call: (args) => callGemini({ ...args, model: "gemini-2.5-flash" }),
    type: "gemini",
  },
  {
    name: "Groq gpt-oss-20b",
    call: (args) => callGroq({ ...args, model: "openai/gpt-oss-20b" }),
    type: "groq",
    requiresKey: "GROQ_API_KEY",
  },
  {
    name: "Gemini 2.5 Flash Lite",
    call: (args) => callGemini({ ...args, model: "gemini-3.5-flash-lite" }),
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
      name: "Groq gpt-oss-20b",
      call: () => callGroq({ model: "openai/gpt-oss-20b", systemPrompt, userPrompt, temperature }),
      requiresKey: "GROQ_API_KEY",
    },
    {
      name: "Gemini 2.5 Flash Lite",
      call: () => callGemini({ model: "gemini-3.5-flash-lite", systemPrompt, userPrompt, temperature }),
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
