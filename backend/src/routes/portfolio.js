const express = require("express");
const router = express.Router();
const { pool } = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM portfolio ORDER BY created_at DESC");
    res.json({ success: true, portfolio: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { title, description, techStack, category, link } = req.body;
    const result = await pool.query(
      "INSERT INTO portfolio (title, description, tech_stack, category, link) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [title, description, techStack, category, link]
    );
    res.json({ success: true, project: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { title, description, techStack, category, link } = req.body;
    const result = await pool.query(
      "UPDATE portfolio SET title=$1,description=$2,tech_stack=$3,category=$4,link=$5 WHERE id=$6 RETURNING *",
      [title, description, techStack, category, link, req.params.id]
    );
    res.json({ success: true, project: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM portfolio WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
