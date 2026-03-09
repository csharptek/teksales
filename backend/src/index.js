require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const { initDB } = require("./db");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || "http://localhost:3000",
    /\.vercel\.app$/,   // allow all Vercel preview URLs
  ],
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use("/api/settings",  require("./routes/settings"));
app.use("/api/proposals", require("./routes/proposals"));
app.use("/api/portfolio", require("./routes/portfolio"));
app.use("/api/ai",        require("./routes/ai"));

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, error: `Route ${req.path} not found` }));

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: err.message });
});

// ── Boot ───────────────────────────────────────────────────────────────────
async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`🚀 API server running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
