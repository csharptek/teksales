const express = require("express");
const router = express.Router();
const { pool } = require("../db");

// ── Helper: get Azure credentials from DB ─────────────────────────────────
async function getAzureSettings() {
  const result = await pool.query("SELECT key, value FROM settings");
  const s = {};
  for (const row of result.rows) s[row.key] = row.value;
  return s;
}

// ── Helper: call Azure OpenAI from server ─────────────────────────────────
async function callAzure(systemPrompt, userMessage, s) {
  if (!s.azureEndpoint || !s.azureKey || !s.azureDeployment) {
    throw new Error("Azure OpenAI credentials not configured. Go to Settings and save your details.");
  }
  const url = `${s.azureEndpoint}/openai/deployments/${s.azureDeployment}/chat/completions?api-version=${s.azureApiVersion || "2024-02-15-preview"}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": s.azureKey },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage },
      ],
      max_tokens: 2500,
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Azure HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── POST /api/ai/analyze — analyze requirements ───────────────────────────
router.post("/analyze", async (req, res) => {
  try {
    const { title, description, budget, questions } = req.body;
    if (!title || !description) {
      return res.status(400).json({ success: false, error: "title and description are required" });
    }

    const settings = await getAzureSettings();
    const sys = `You are a senior software analyst. Extract structured project requirements.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{"modules":["string"],"features":["string"],"integrations":["string"],"complexity":"Low"|"Medium"|"High"|"Very High","estimatedHours":number,"score":"Strategic"|"Revenue"|"Cash","scoreReason":"string","riskFlag":"Low"|"Medium"|"High","estimatedValue":number,"scopeNote":"string"}`;

    const msg = `Title: ${title}\nDescription: ${description}\nBudget: ${budget || "unspecified"}\nClient Questions: ${questions || "none"}`;
    const raw = await callAzure(sys, msg, settings);
    const analysis = JSON.parse(raw.replace(/```json|```/g, "").trim());

    res.json({ success: true, analysis });
  } catch (err) {
    console.error("POST /ai/analyze error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/ai/proposal — generate proposal ─────────────────────────────
router.post("/proposal", async (req, res) => {
  try {
    const { title, clientName, description, budget, analysis } = req.body;
    const settings = await getAzureSettings();

    const sys = `You are a senior software consulting partner writing professional Upwork proposals.
Rules: Use "We recommend", "Typically", "To control cost and risk". Tone: calm, confident, client-ready.
Structure: Project Understanding, What's Included, What's Excluded, Our Approach, Post-Launch Support.
End with a markdown milestone table: | Milestone | Scope | Duration | Cost | Timeline |
Keep under 650 words. Use clean markdown.`;

    const a = analysis || {};
    const msg = `Title: ${title}
Client: ${clientName || "N/A"}
Description: ${description}
Budget: ${budget || "Not specified"}
Modules: ${(a.modules || []).join(", ")}
Features: ${(a.features || []).join(", ")}
Integrations: ${(a.integrations || []).join(", ")}
Complexity: ${a.complexity} | Est Hours: ${a.estimatedHours}
Lead Type: ${a.score} | Scope Note: ${a.scopeNote}`;

    const proposal = await callAzure(sys, msg, settings);
    res.json({ success: true, proposal });
  } catch (err) {
    console.error("POST /ai/proposal error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/ai/edit — AI edit proposal text ─────────────────────────────
router.post("/edit", async (req, res) => {
  try {
    const { text, action, customInstruction } = req.body;
    const settings = await getAzureSettings();

    const instructions = {
      Rewrite: "Rewrite this proposal section with sharper, more confident language. Preserve all facts.",
      Expand:  "Expand with more specific detail, examples, and confidence. Keep professional tone.",
      Shorten: "Shorten significantly while keeping all essential information and the milestone table.",
    };
    const sys = `You are an expert proposal editor. ${instructions[action] || `Apply this instruction: ${customInstruction}`} Return ONLY the edited markdown, no preamble.`;
    const result = await callAzure(sys, text, settings);
    res.json({ success: true, result });
  } catch (err) {
    console.error("POST /ai/edit error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
