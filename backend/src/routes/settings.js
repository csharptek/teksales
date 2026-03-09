const express = require("express");
const router = express.Router();
const { pool } = require("../db");

// ── Helper: read all settings from DB into a plain object ──────────────────
async function getSettingsFromDB() {
  const result = await pool.query("SELECT key, value FROM settings");
  const settings = {};
  for (const row of result.rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ── Helper: upsert a single key/value ─────────────────────────────────────
async function upsertSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
}

// ── GET /api/settings — return all settings (mask sensitive keys) ──────────
router.get("/", async (req, res) => {
  try {
    const settings = await getSettingsFromDB();

    // Mask sensitive fields before sending to frontend
    const masked = { ...settings };
    const sensitiveKeys = ["azureKey", "azureSearchKey", "azureStorageConnection", "jwtSecret"];
    for (const key of sensitiveKeys) {
      if (masked[key]) {
        masked[key] = "••••••••••••••••"; // mask, but signal it is saved
      }
    }

    res.json({ success: true, settings: masked });
  } catch (err) {
    console.error("GET /settings error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/settings — save all settings to DB ──────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      companyName, companyTagline,
      azureEndpoint, azureKey, azureDeployment, azureApiVersion,
      azureSearchEndpoint, azureSearchKey, azureSearchIndex,
      azureStorageConnection, azureStorageContainer,
    } = req.body;

    const fields = {
      companyName, companyTagline,
      azureEndpoint, azureDeployment, azureApiVersion,
      azureSearchEndpoint, azureSearchIndex, azureStorageContainer,
    };

    // Save non-sensitive fields always
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        await upsertSetting(key, value || "");
      }
    }

    // Only save sensitive fields if they are NOT masked (i.e. user actually typed a new value)
    const sensitiveFields = { azureKey, azureSearchKey, azureStorageConnection };
    for (const [key, value] of Object.entries(sensitiveFields)) {
      if (value && value !== "••••••••••••••••") {
        await upsertSetting(key, value);
      }
    }

    res.json({ success: true, message: "Settings saved successfully" });
  } catch (err) {
    console.error("POST /settings error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/settings/test — test Azure OpenAI from server side ───────────
router.post("/test", async (req, res) => {
  try {
    // Always read credentials from DB — never trust what frontend sends
    const settings = await getSettingsFromDB();

    const endpoint = settings.azureEndpoint;
    const apiKey   = settings.azureKey;
    const deploy   = settings.azureDeployment;
    const version  = settings.azureApiVersion;

    if (!endpoint || !apiKey || !deploy || !version) {
      return res.status(400).json({
        success: false,
        error: "Azure OpenAI credentials are incomplete. Please save your settings first.",
      });
    }

    const url = `${endpoint}/openai/deployments/${deploy}/chat/completions?api-version=${version}`;

    const azureRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user",   content: "Reply with exactly: CONNECTION_OK" },
        ],
        max_completion_tokens: 20,
        temperature: 0,
      }),
    });

    if (!azureRes.ok) {
      const errBody = await azureRes.json().catch(() => ({}));
      const message = errBody?.error?.message || `HTTP ${azureRes.status}`;
      return res.status(400).json({ success: false, error: `Azure error: ${message}` });
    }

    const data = await azureRes.json();
    const reply = data?.choices?.[0]?.message?.content || "";

    res.json({
      success: true,
      message: `Connection successful — model responded: "${reply.trim()}"`,
      model: data?.model || deploy,
    });
  } catch (err) {
    console.error("POST /settings/test error:", err);
    res.status(500).json({ success: false, error: `Server error: ${err.message}` });
  }
});

module.exports = router;
