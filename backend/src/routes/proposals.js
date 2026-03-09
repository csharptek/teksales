const express = require("express");
const router = express.Router();
const { pool } = require("../db");

// ── GET /api/proposals — list all ─────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM proposals ORDER BY created_at DESC"
    );
    res.json({ success: true, proposals: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/proposals/:id ─────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM proposals WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, proposal: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/proposals — create ───────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      clientName, title, description, questions, figmaLink,
      budget, analysis, proposalText, status, estimatedValue, score, riskFlag,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO proposals
        (client_name, title, description, questions, figma_link,
         budget, analysis, proposal_text, status, estimated_value, score, risk_flag)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        clientName, title, description, questions, figmaLink,
        budget, JSON.stringify(analysis || {}), proposalText,
        status || "Draft", estimatedValue || 0, score, riskFlag,
      ]
    );
    res.json({ success: true, proposal: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/proposals/:id — update ───────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const {
      clientName, title, description, questions, figmaLink,
      budget, analysis, proposalText, status, estimatedValue, score, riskFlag,
    } = req.body;

    const result = await pool.query(
      `UPDATE proposals SET
        client_name=$1, title=$2, description=$3, questions=$4, figma_link=$5,
        budget=$6, analysis=$7, proposal_text=$8, status=$9,
        estimated_value=$10, score=$11, risk_flag=$12, updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [
        clientName, title, description, questions, figmaLink,
        budget, JSON.stringify(analysis || {}), proposalText,
        status, estimatedValue || 0, score, riskFlag, req.params.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, proposal: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/proposals/:id ─────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM proposals WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
