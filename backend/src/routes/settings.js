const express = require("express");
const router  = express.Router();
const { pool } = require("../db");

async function getSettingsFromDB() {
  const result = await pool.query("SELECT key, value FROM settings");
  const s = {};
  for (const row of result.rows) s[row.key] = row.value;
  return s;
}

async function upsertSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
}

// GET /api/settings — return all (mask secrets)
router.get("/", async (req, res) => {
  try {
    const settings = await getSettingsFromDB();
    const masked = { ...settings };
    for (const key of ["azureKey","azureSearchKey","azureStorageConnection"]) {
      if (masked[key]) masked[key] = "••••••••••••••••";
    }
    res.json({ success: true, settings: masked });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings — save to DB
router.post("/", async (req, res) => {
  try {
    const {
      companyName, companyTagline,
      azureEndpoint, azureKey, azureDeployment, azureApiVersion,
      azureSearchEndpoint, azureSearchKey, azureSearchIndex,
      azureStorageConnection, azureStorageContainer,
    } = req.body;

    // Non-sensitive — always save
    const plain = {
      companyName, companyTagline, azureEndpoint, azureDeployment,
      azureApiVersion, azureSearchEndpoint, azureSearchIndex, azureStorageContainer,
    };
    for (const [key, value] of Object.entries(plain)) {
      if (value !== undefined) await upsertSetting(key, value || "");
    }

    // Sensitive — only save if user typed a new value (not masked placeholder)
    for (const [key, value] of Object.entries({ azureKey, azureSearchKey, azureStorageConnection })) {
      if (value && value !== "••••••••••••••••") await upsertSetting(key, value);
    }

    res.json({ success: true, message: "Settings saved successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/test — server reads from DB and calls Azure (no CORS)
router.post("/test", async (req, res) => {
  try {
    const s = await getSettingsFromDB();

    if (!s.azureEndpoint || !s.azureKey || !s.azureDeployment || !s.azureApiVersion) {
      return res.status(400).json({
        success: false,
        error: "Azure OpenAI credentials are incomplete. Save your settings first.",
      });
    }

    const url = `${s.azureEndpoint}/openai/deployments/${s.azureDeployment}/chat/completions?api-version=${s.azureApiVersion}`;

    const azureRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": s.azureKey },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Reply with exactly: CONNECTION_OK" },
        ],
        max_completion_tokens: 20,
      }),
    });

    if (!azureRes.ok) {
      const errBody = await azureRes.json().catch(() => ({}));
      const message = errBody?.error?.message || `HTTP ${azureRes.status}`;
      return res.status(400).json({ success: false, error: `Azure error: ${message}` });
    }

    const data  = await azureRes.json();
    const reply = data?.choices?.[0]?.message?.content || "";
    res.json({
      success: true,
      message: `Connection successful — model replied: "${reply.trim()}"`,
      model: data?.model || s.azureDeployment,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: `Server error: ${err.message}` });
  }
});

module.exports = router;
