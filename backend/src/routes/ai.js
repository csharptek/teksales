const express  = require("express");
const router   = express.Router();
const { pool } = require("../db");

// ── Get Azure credentials from DB ─────────────────────────────────────────
async function getAzureSettings() {
  const result = await pool.query("SELECT key, value FROM settings");
  const s = {};
  for (const row of result.rows) s[row.key] = row.value;
  return s;
}

// ── Get all portfolio projects from DB ────────────────────────────────────
async function getPortfolio() {
  const result = await pool.query("SELECT * FROM portfolio ORDER BY created_at DESC");
  return result.rows;
}

// ── Get company info from settings ────────────────────────────────────────
async function getCompanyInfo() {
  const result = await pool.query(
    "SELECT key, value FROM settings WHERE key IN ('companyName','companyTagline')"
  );
  const info = {};
  for (const row of result.rows) info[row.key] = row.value;
  return {
    name:    info.companyName    || "Our Company",
    tagline: info.companyTagline || "Software Consulting & Development",
  };
}

// ── Build portfolio context block injected into every prompt ──────────────
// All rich fields (problem, solution, outcome, testimonial, videos) are included
// so AI can reference real past work naturally in proposals
function buildPortfolioContext(projects) {
  if (!projects || projects.length === 0) {
    return "(No portfolio projects yet — add some in the Portfolio section to improve proposals.)";
  }
  return projects.map((p, i) => {
    const lines = [`${i + 1}. ${p.title}`];
    if (p.category)            lines.push(`   Category: ${p.category}`);
    if (p.client_name)         lines.push(`   Client: ${p.client_name}`);
    if (p.tech_stack)          lines.push(`   Tech Stack: ${p.tech_stack}`);
    if (p.description)         lines.push(`   Description: ${p.description}`);
    if (p.problem_solved)      lines.push(`   Problem Solved: ${p.problem_solved}`);
    if (p.solution)            lines.push(`   Solution Built: ${p.solution}`);
    if (p.outcome)             lines.push(`   Outcome/Results: ${p.outcome}`);
    if (p.client_testimonial)  lines.push(`   Client Said: "${p.client_testimonial}"`);
    if (p.website_url)         lines.push(`   Live Site: ${p.website_url}`);
    const yt = p.youtube_links;
    if (yt && yt.length > 0)   lines.push(`   Demo Videos: ${yt.join(", ")}`);
    return lines.join("\n");
  }).join("\n\n");
}

// ── Call Azure OpenAI ─────────────────────────────────────────────────────
async function callAzure(messages, s) {
  if (!s.azureEndpoint || !s.azureKey || !s.azureDeployment) {
    throw new Error("Azure OpenAI credentials not configured. Go to Settings and save your details.");
  }
  const url = `${s.azureEndpoint}/openai/deployments/${s.azureDeployment}/chat/completions?api-version=${s.azureApiVersion || "2024-02-15-preview"}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": s.azureKey },
    body: JSON.stringify({
      messages,
      max_completion_tokens: 3000,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Azure HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}


// ═════════════════════════════════════════════════════════════════════════
// POST /api/ai/analyze
// Analyzes job description + identifies relevant portfolio projects
// ═════════════════════════════════════════════════════════════════════════
router.post("/analyze", async (req, res) => {
  try {
    const { title, description, budget, questions } = req.body;
    if (!title || !description) {
      return res.status(400).json({ success: false, error: "title and description are required" });
    }

    const [settings, portfolio, company] = await Promise.all([
      getAzureSettings(), getPortfolio(), getCompanyInfo(),
    ]);

    const portfolioContext = buildPortfolioContext(portfolio);

    const messages = [
      {
        role: "user",
        content: `You are a senior software analyst at ${company.name} (${company.tagline}).

## Our Past Delivered Projects
Use these to understand the types of work we do. Reference relevant projects when scoring the lead.

${portfolioContext}

## Task
Analyze this Upwork job lead. Return ONLY valid JSON — no markdown fences, no explanation.

JSON shape (exact):
{
  "modules": ["string"],
  "features": ["string"],
  "integrations": ["string"],
  "complexity": "Low" | "Medium" | "High" | "Very High",
  "estimatedHours": number,
  "score": "Strategic" | "Revenue" | "Cash",
  "scoreReason": "one sentence",
  "riskFlag": "Low" | "Medium" | "High",
  "estimatedValue": number,
  "scopeNote": "one sentence — mention relevant past work if applicable",
  "relevantPortfolioProjects": ["matching project titles from our portfolio, or empty array"]
}

Notes:
- estimatedValue = USD number only (no $ or commas)
- Strategic = complex high-value, Revenue = solid mid-tier, Cash = quick simple

## Job Lead
Title: ${title}
Description: ${description}
Client Budget: ${budget || "Not specified"}
Client Questions: ${questions || "None"}`,
      },
    ];

    const raw      = await callAzure(messages, settings);
    const analysis = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json({ success: true, analysis });
  } catch (err) {
    console.error("POST /ai/analyze error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ═════════════════════════════════════════════════════════════════════════
// POST /api/ai/proposal
// Generates full Upwork proposal using portfolio context + analysis
// ═════════════════════════════════════════════════════════════════════════
router.post("/proposal", async (req, res) => {
  try {
    const { title, clientName, description, budget, questions, analysis } = req.body;

    const [settings, portfolio, company] = await Promise.all([
      getAzureSettings(), getPortfolio(), getCompanyInfo(),
    ]);

    const portfolioContext = buildPortfolioContext(portfolio);
    const a = analysis || {};

    const messages = [
      {
        role: "user",
        content: `You are a senior software consulting partner at ${company.name} — ${company.tagline}.

## Our Portfolio — Delivered Projects
Reference 1–2 of these naturally in the proposal where relevant. Do NOT list all of them.
Mention specific past projects to build credibility e.g. "Having built X for a similar client..."

${portfolioContext}

## Proposal Writing Rules
- Tone: calm, confident, client-ready. Never salesy.
- Always use: "We recommend", "Typically", "To control cost and risk"
- Reference matching past work naturally to build trust
- Do NOT mention hourly rates or make unlimited promises
- If scope likely exceeds budget, flag it diplomatically
- Answer any specific client questions within the proposal

## Required Sections (exact markdown headings)
### Understanding Your Requirements
### What's Included
### What's Excluded
### Our Approach
### Relevant Experience
### Post-Launch Support

## Milestone Table
End with this table (fill in realistic values):
| Milestone | Scope | Duration | Cost | Timeline |
|-----------|-------|----------|------|----------|

Keep under 700 words total. Clean markdown only.

## This Job
Title: ${title}
Client: ${clientName || "Not specified"}
Description: ${description}
Client Questions: ${questions || "None"}
Budget: ${budget || "Not specified"}

Analysis Results:
- Modules: ${(a.modules || []).join(", ") || "N/A"}
- Features: ${(a.features || []).join(", ") || "N/A"}
- Integrations: ${(a.integrations || []).join(", ") || "N/A"}
- Complexity: ${a.complexity || "N/A"} | Est Hours: ${a.estimatedHours || "N/A"}
- Lead Type: ${a.score || "N/A"} | Risk: ${a.riskFlag || "N/A"}
- Scope Note: ${a.scopeNote || "N/A"}
- Matching Portfolio Projects: ${(a.relevantPortfolioProjects || []).join(", ") || "Use judgment"}`,
      },
    ];

    const proposal = await callAzure(messages, settings);
    res.json({ success: true, proposal });
  } catch (err) {
    console.error("POST /ai/proposal error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ═════════════════════════════════════════════════════════════════════════
// POST /api/ai/edit
// AI-assisted proposal editing with full conversation history support
// Body: { text, action, customInstruction, history (optional) }
// ═════════════════════════════════════════════════════════════════════════
router.post("/edit", async (req, res) => {
  try {
    const { text, action, customInstruction, history } = req.body;
    const [settings, company] = await Promise.all([getAzureSettings(), getCompanyInfo()]);

    const actionInstructions = {
      Rewrite: "Rewrite with sharper, more confident consulting language. Preserve all facts, numbers, and the milestone table.",
      Expand:  "Expand with more specific detail, methodology, and confidence. Keep professional tone.",
      Shorten: "Shorten significantly — keep only the most impactful points and the milestone table.",
    };

    const systemInstruction = actionInstructions[action]
      || `Apply this instruction: "${customInstruction}"`;

    // Build messages — include conversation history if provided (chat mode)
    const messages = [
      {
        role: "user",
        content: `You are an expert proposal editor for ${company.name} — a software consulting firm.
${systemInstruction}
Rules:
- Maintain consulting tone: calm, confident, client-ready
- Use "We recommend", "Typically", "To control cost and risk" where appropriate
- Keep all markdown formatting intact (headings, bullet points, tables)
- Return ONLY the edited markdown — no preamble, no explanation

${history && history.length > 0 ? "" : `Current proposal text:\n\n${text}`}`,
      },
    ];

    // If chat history provided, append it (enables multi-turn editing)
    if (history && history.length > 0) {
      messages.push(...history);
      messages.push({ role: "user", content: text });
    }

    const result = await callAzure(messages, settings);
    res.json({ success: true, result });
  } catch (err) {
    console.error("POST /ai/edit error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ═════════════════════════════════════════════════════════════════════════
// POST /api/ai/chat
// Conversational proposal editor — maintains full message history
// Body: { proposal, history: [{role, content}], message }
// ═════════════════════════════════════════════════════════════════════════
router.post("/chat", async (req, res) => {
  try {
    const { proposal, history = [], message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: "message is required" });

    const [settings, company] = await Promise.all([getAzureSettings(), getCompanyInfo()]);

    // System context — sets the AI role for the entire conversation
    const systemContext = `You are an expert proposal editor for ${company.name} — a software consulting firm.
You are helping edit and improve an Upwork proposal through conversation.

Rules:
- When the user asks you to change something, return the FULL updated proposal
- When the user asks a question, answer it directly without rewriting the proposal
- Maintain consulting tone: calm, confident, client-ready
- Use "We recommend", "Typically", "To control cost and risk"
- Keep all markdown formatting intact
- If returning an updated proposal, wrap it in <proposal>...</proposal> tags
- If just answering a question or explaining, reply normally without tags

Current proposal:
${proposal}`;

    // Build full message history for this conversation
    const messages = [
      { role: "user", content: systemContext },
      { role: "assistant", content: "I'm ready to help you refine this proposal. What would you like to change or improve?" },
      ...history,
      { role: "user", content: message },
    ];

    const result = await callAzure(messages, settings);

    // Check if response contains updated proposal
    const proposalMatch = result.match(/<proposal>([\s\S]*?)<\/proposal>/);
    const updatedProposal = proposalMatch ? proposalMatch[1].trim() : null;
    const chatResponse    = proposalMatch
      ? result.replace(/<proposal>[\s\S]*?<\/proposal>/, "").trim() || "I've updated the proposal."
      : result;

    res.json({
      success: true,
      chatResponse,
      updatedProposal, // null if AI just answered a question
    });
  } catch (err) {
    console.error("POST /ai/chat error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


module.exports = router;
