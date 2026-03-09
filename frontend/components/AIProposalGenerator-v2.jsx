import { useState, useEffect, useRef } from "react";

// ── Backend API base URL ────────────────────────────────────────────────────
// Change this to your Railway backend URL when deployed
// e.g. "https://your-app.up.railway.app"
// Set NEXT_PUBLIC_API_URL in your Vercel environment variables
const API_BASE = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) || "http://localhost:3001";

const DEFAULT_SETTINGS = {
  companyName: "CSharpTek",
  companyTagline: "Software Consulting & Development",
  azureEndpoint: "", azureKey: "", azureDeployment: "", azureApiVersion: "",
};

// ── API helpers ────────────────────────────────────────────────────────────
// Tries Railway backend first. If unavailable, falls back to Anthropic API.
let _backendAvailable = null;
async function checkBackend() {
  if (_backendAvailable !== null) return _backendAvailable;
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    _backendAvailable = res.ok;
  } catch { _backendAvailable = false; }
  return _backendAvailable;
}

async function apiCall(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

// Direct Anthropic API fallback (when backend is offline)
async function callAnthropic(systemPrompt, userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

const C = {
  bg: "#F8F7F4",
  surface: "#FFFFFF",
  surfaceAlt: "#F3F2EF",
  border: "#E8E6E1",
  borderStrong: "#D4D1CA",
  text: "#1A1814",
  textMid: "#6B6760",
  textSoft: "#9C9890",
  accent: "#2D6A4F",
  accentLight: "#EAF2EE",
  accentMid: "#52B788",
  danger: "#C0392B",
  dangerLight: "#FDF2F1",
  amber: "#B7791F",
  amberLight: "#FEF9EE",
  blue: "#2563EB",
  blueLight: "#EFF6FF",
  shadow: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)",
  shadowMd: "0 4px 16px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.04)",
  shadowLg: "0 12px 40px rgba(0,0,0,.1), 0 4px 8px rgba(0,0,0,.04)",
};

// ── AI calls — backend when available, Anthropic API as fallback ─────────
async function analyzeRequirements(payload) {
  const hasBackend = await checkBackend();
  if (hasBackend) {
    const data = await apiCall("/api/ai/analyze", "POST", payload);
    return data.analysis;
  }
  // Fallback: call Anthropic directly
  const sys = `You are a senior software analyst. Extract structured project requirements.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{"modules":["string"],"features":["string"],"integrations":["string"],"complexity":"Low"|"Medium"|"High"|"Very High","estimatedHours":number,"score":"Strategic"|"Revenue"|"Cash","scoreReason":"string","riskFlag":"Low"|"Medium"|"High","estimatedValue":number,"scopeNote":"string","relevantPortfolioProjects":[]}`;
  const msg = `Title: ${payload.title}\nDescription: ${payload.description}\nBudget: ${payload.budget || "unspecified"}\nQuestions: ${payload.questions || "none"}`;
  const raw = await callAnthropic(sys, msg);
  return JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g, "").trim());
}

async function generateProposal(payload) {
  const hasBackend = await checkBackend();
  if (hasBackend) {
    const data = await apiCall("/api/ai/proposal", "POST", payload);
    return data.proposal;
  }
  // Fallback: call Anthropic directly
  const a = payload.analysis || {};
  const sys = `You are a senior software consulting partner writing professional Upwork proposals.
Rules: Use "We recommend", "Typically", "To control cost and risk". Tone: calm, confident, client-ready.
Structure with these headings: ### Understanding Your Requirements / ### What's Included / ### What's Excluded / ### Our Approach / ### Post-Launch Support
End with a milestone table: | Milestone | Scope | Duration | Cost | Timeline |
Keep under 700 words. Use clean markdown.`;
  const msg = `Title: ${payload.title}\nClient: ${payload.clientName || "N/A"}\nDescription: ${payload.description}\nBudget: ${payload.budget || "Not specified"}\nModules: ${(a.modules||[]).join(", ")}\nComplexity: ${a.complexity} | Hours: ${a.estimatedHours}\nLead Type: ${a.score} | Risk: ${a.riskFlag}\nScope Note: ${a.scopeNote}`;
  return await callAnthropic(sys, msg);
}

async function editProposal(payload) {
  const hasBackend = await checkBackend();
  if (hasBackend) {
    const data = await apiCall("/api/ai/edit", "POST", payload);
    return data.result;
  }
  // Fallback: call Anthropic directly
  const instructions = {
    Rewrite: "Rewrite with sharper, more confident consulting language. Preserve all facts and the milestone table.",
    Expand: "Expand with more specific detail and confidence. Keep professional tone.",
    Shorten: "Shorten significantly — keep only the most impactful points and the milestone table.",
  };
  const instruction = instructions[payload.action] || `Apply this instruction: "${payload.customInstruction}"`;
  const sys = `You are an expert proposal editor. ${instruction} Return ONLY the edited markdown, no preamble.`;
  return await callAnthropic(sys, payload.text);
}

// ── Backend data helpers ───────────────────────────────────────────────────
async function fetchProposals()  { const d = await apiCall("/api/proposals");  return d.proposals  || []; }
async function fetchPortfolio()  { const d = await apiCall("/api/portfolio");  return d.portfolio  || []; }
async function fetchSettings()   { const d = await apiCall("/api/settings");   return d.settings   || {}; }

// ── Utils ──────────────────────────────────────────────────────────────────
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const relTime = (ts) => {
  const d = Date.now() - ts;
  if (d < 60000) return "just now";
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
};

const SCORE_CONFIG = {
  Strategic: { color: C.accent, bg: C.accentLight, dot: "#2D6A4F" },
  Revenue:   { color: C.blue,   bg: C.blueLight,   dot: "#2563EB" },
  Cash:      { color: C.amber,  bg: C.amberLight,  dot: "#B7791F" },
};
const RISK_CONFIG = {
  Low:    { color: "#16A34A", bg: "#F0FDF4" },
  Medium: { color: C.amber,  bg: C.amberLight },
  High:   { color: C.danger, bg: C.dangerLight },
};

function mdToHtml(md = "") {
  let h = md
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/^### (.+)$/gm,"<h3>$1</h3>")
    .replace(/^## (.+)$/gm,"<h2>$1</h2>")
    .replace(/^# (.+)$/gm,"<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,"<em>$1</em>")
    .replace(/^&gt; (.+)$/gm,"<blockquote>$1</blockquote>")
    .replace(/^[-*] (.+)$/gm,"<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g,"<ul>$1</ul>")
    .replace(/<\/ul>\s*<ul>/g,"");
  h = h.replace(/(\|.+\|\n)(\|[-| :]+\|\n)((?:\|.+\|\n?)+)/g, (_, hdr, __, body) => {
    const ths = hdr.split("|").filter(c=>c.trim()).map(c=>`<th>${c.trim()}</th>`).join("");
    const rows = body.trim().split("\n").map(r=>{
      const tds = r.split("|").filter(c=>c.trim()).map(c=>`<td>${c.trim()}</td>`).join("");
      return `<tr>${tds}</tr>`;
    }).join("");
    return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
  });
  h = h.replace(/\n\n+/g,"</p><p>").replace(/\n/g,"<br/>");
  h = `<p>${h}</p>`;
  ["h1","h2","h3","ul","table","blockquote"].forEach(t => {
    h = h.replace(new RegExp(`<p>(<${t}>)`,"g"),"$1").replace(new RegExp(`(</${t}>)<\/p>`,"g"),"$1");
  });
  return h.replace(/<p>\s*<\/p>/g,"");
}

// ── Primitives ─────────────────────────────────────────────────────────────
const Spinner = ({ size = 18, color = C.accent }) => (
  <div style={{ width: size, height: size, border: `2px solid ${color}30`, borderTop: `2px solid ${color}`, borderRadius: "50%", animation: "apg-spin .65s linear infinite", flexShrink: 0 }} />
);

function Tag({ label, config }) {
  const cfg = config || { color: C.textMid, bg: C.surfaceAlt };
  return (
    <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}25`, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 600, letterSpacing: ".03em" }}>
      {label}
    </span>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, size = "md", icon }) {
  const variants = {
    primary:   { bg: C.accent,      color: "#fff",       border: C.accent,       hover: "#245A41" },
    secondary: { bg: C.surface,     color: C.text,       border: C.border,       hover: C.surfaceAlt },
    ghost:     { bg: "transparent", color: C.textMid,    border: "transparent",  hover: C.surfaceAlt },
    danger:    { bg: C.dangerLight, color: C.danger,     border: `${C.danger}30`, hover: "#FDECEA" },
    outline:   { bg: "transparent", color: C.accent,     border: C.accentMid,    hover: C.accentLight },
  };
  const v = variants[variant] || variants.primary;
  const pad = size === "sm" ? "5px 12px" : size === "lg" ? "11px 24px" : "8px 18px";
  const fs = size === "sm" ? 12 : size === "lg" ? 14 : 13;
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov && !disabled ? v.hover : v.bg, color: v.color, border: `1px solid ${v.border}`, borderRadius: 8, padding: pad, fontSize: fs, fontFamily: "inherit", fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1, transition: "all .15s", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", letterSpacing: ".01em" }}>
      {icon && <span style={{ fontSize: fs - 1 }}>{icon}</span>}
      {children}
    </button>
  );
}

function Field({ label, required, optional, hint, children }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.text, letterSpacing: ".01em" }}>{label}</label>
        {required && <span style={{ fontSize: 11, color: C.accent, fontWeight: 600 }}>*</span>}
        {optional && <span style={{ fontSize: 11, color: C.textSoft, fontWeight: 400 }}>Optional</span>}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textSoft, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputBase = (focused) => ({
  width: "100%", background: C.surface, border: `1.5px solid ${focused ? C.accent : C.border}`,
  borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, fontFamily: "inherit",
  outline: "none", transition: "border-color .15s, box-shadow .15s",
  boxShadow: focused ? `0 0 0 3px ${C.accent}18` : "none",
});

function TextInput({ label, name, value, onChange, placeholder, type = "text", required, optional, hint }) {
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} required={required} optional={optional} hint={hint}>
      <input type={type} name={name} value={value} onChange={onChange} placeholder={placeholder}
        style={inputBase(focused)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
    </Field>
  );
}

function TextArea({ label, name, value, onChange, placeholder, rows = 4, required, optional, hint }) {
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} required={required} optional={optional} hint={hint}>
      <textarea name={name} value={value} onChange={onChange} placeholder={placeholder} rows={rows}
        style={{ ...inputBase(focused), resize: "none", lineHeight: 1.7 }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
    </Field>
  );
}

function Card({ children, style, padding = "20px 24px" }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding, boxShadow: C.shadow, ...style }}>
      {children}
    </div>
  );
}

function SectionHeader({ eyebrow, title, subtitle }) {
  return (
    <div style={{ marginBottom: 28 }}>
      {eyebrow && <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>{eyebrow}</div>}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-.02em" }}>{title}</h1>
      {subtitle && <p style={{ fontSize: 13, color: C.textMid, marginTop: 6, lineHeight: 1.6 }}>{subtitle}</p>}
    </div>
  );
}

function MetricCard({ label, value, icon, accent = C.accent }) {
  return (
    <Card style={{ flex: 1, minWidth: 140 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent, marginTop: 6 }} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: "-.03em", marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.textSoft, fontWeight: 500 }}>{label}</div>
    </Card>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [proposals, setProposals] = useState([]);
  const [portfolio, setPortfolio] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [wizardState, setWizardState] = useState({ step: 1, data: null });
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchProposals().then(setProposals).catch(() => {}),
      fetchPortfolio().then(setPortfolio).catch(() => {}),
      fetchSettings().then(s => setSettings({ ...DEFAULT_SETTINGS, ...s })).catch(() => {}),
    ]).finally(() => setBooting(false));
  }, []);

  // Reload from backend and update state
  const reloadProposals = async () => { const p = await fetchProposals(); setProposals(p); return p; };
  const reloadPortfolio = async () => { const p = await fetchPortfolio(); setPortfolio(p); return p; };
  const saveSettings    = async (s) => { setSettings(s); }; // settings saved via /api/settings POST in SettingsPage

  const startWizard = (data = null, step = 1) => {
    setWizardState({ step, data });
    setPage("wizard");
  };

  const finishWizard = async (finalProposal) => {
    try {
      const isExisting = proposals.some(p => p.id === finalProposal.id);
      const payload = {
        clientName:    finalProposal.clientName,
        title:         finalProposal.title,
        description:   finalProposal.description,
        questions:     finalProposal.questions,
        figmaLink:     finalProposal.figmaLink,
        budget:        finalProposal.budget,
        analysis:      finalProposal.analysis,
        proposalText:  finalProposal.proposal,
        status:        "Draft",
        estimatedValue: finalProposal.analysis?.estimatedValue || 0,
        score:         finalProposal.analysis?.score,
        riskFlag:      finalProposal.analysis?.riskFlag,
      };
      if (isExisting) {
        await apiCall(`/api/proposals/${finalProposal.id}`, "PUT", payload);
      } else {
        await apiCall("/api/proposals", "POST", payload);
      }
      await reloadProposals();
    } catch (e) {
      alert(`Failed to save proposal: ${e.message}`);
    }
    setPage("history");
  };

  const metrics = {
    total: proposals.length,
    won: proposals.filter(p => p.status === "Won").length,
    pipeline: proposals.reduce((a, p) => a + (Number(p.estimatedValue) || 0), 0),
    generated: proposals.length,
  };

  if (booting) return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <Spinner size={28} />
        <span style={{ fontSize: 13, color: C.textSoft }}>Loading...</span>
      </div>
    </div>
  );

  const navItems = [
    { id: "dashboard", icon: "⊞", label: "Dashboard" },
    { id: "wizard",    icon: "+", label: "New Proposal", special: true },
    { id: "history",   icon: "≡", label: "History", count: proposals.length },
    { id: "portfolio", icon: "◈", label: "Portfolio", count: portfolio.length },
    { id: "settings",  icon: "⚙", label: "Settings" },
  ];

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', 'DM Sans', system-ui, sans-serif", background: C.bg, minHeight: "100vh", display: "flex" }}>
      <GlobalStyles />

      {/* Sidebar */}
      <aside style={{ width: 228, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>
        {/* Logo */}
        <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, background: `linear-gradient(135deg, ${C.accent}, ${C.accentMid})`, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 2px 8px ${C.accent}40` }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>CS</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: "-.01em" }}>{settings.companyName}</div>
              <div style={{ fontSize: 10, color: C.textSoft, fontWeight: 500, letterSpacing: ".02em" }}>Proposal AI</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: "12px 10px", flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map(item => {
            const isActive = page === item.id && item.id !== "wizard";
            return (
              <NavItem key={item.id} item={item} isActive={isActive}
                onClick={() => item.id === "wizard" ? startWizard() : setPage(item.id)} />
            );
          })}
        </nav>

        {/* Status footer */}
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: C.textSoft }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: settings.azureKey && settings.azureKey.length > 10 ? "#16A34A" : "#EF4444", flexShrink: 0 }} />
            Azure {settings.azureKey && settings.azureKey.length > 10 ? "Connected" : "Not configured"}
          </div>
        </div>
      </aside>

      {/* Content */}
      <main style={{ flex: 1, overflow: "auto", minHeight: "100vh" }}>
        {page === "dashboard" && <Dashboard metrics={metrics} proposals={proposals} onOpen={(p) => startWizard(p, 5)} onNew={() => startWizard()} />}
        {page === "wizard"    && <WizardShell state={wizardState} setState={setWizardState} settings={settings} onFinish={finishWizard} onCancel={() => setPage("dashboard")} />}
        {page === "history"   && <History proposals={proposals} onOpen={(p) => startWizard(p, 5)} onDelete={async (id) => { await apiCall(`/api/proposals/${id}`, "DELETE"); await reloadProposals(); }} />}
        {page === "portfolio" && <Portfolio portfolio={portfolio} onReload={reloadPortfolio} />}
        {page === "settings"  && <SettingsPage settings={settings} onSave={saveSettings} />}
      </main>
    </div>
  );
}

function NavItem({ item, isActive, onClick }) {
  const [hov, setHov] = useState(false);
  const isNew = item.special;
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, cursor: "pointer",
        background: isNew ? `linear-gradient(135deg,${C.accent},${C.accentMid})` : isActive ? C.accentLight : hov ? C.surfaceAlt : "transparent",
        color: isNew ? "#fff" : isActive ? C.accent : hov ? C.text : C.textMid,
        transition: "all .15s", marginBottom: isNew ? 4 : 0 }}>
      <span style={{ fontSize: 14, width: 18, textAlign: "center", fontWeight: isNew ? 700 : 400 }}>{item.icon}</span>
      <span style={{ fontSize: 13, fontWeight: isActive || isNew ? 600 : 500, flex: 1 }}>{item.label}</span>
      {item.count > 0 && !isNew && (
        <span style={{ background: isActive ? C.accent : C.surfaceAlt, color: isActive ? "#fff" : C.textMid, borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 600 }}>{item.count}</span>
      )}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ metrics, proposals, onOpen, onNew }) {
  const recent = proposals.slice(0, 6);
  return (
    <div className="apg-in" style={{ padding: "32px 36px", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28 }}>
        <SectionHeader eyebrow="Overview" title="Dashboard" subtitle="Track your proposal pipeline and conversion activity." />
        <Btn onClick={onNew} size="md" icon="+" variant="primary">New Proposal</Btn>
      </div>

      {/* Metrics */}
      <div style={{ display: "flex", gap: 14, marginBottom: 28, flexWrap: "wrap" }}>
        <MetricCard label="Total Leads" value={metrics.total} icon="📋" accent={C.accent} />
        <MetricCard label="Proposals Sent" value={metrics.generated} icon="📤" accent={C.blue} />
        <MetricCard label="Deals Won" value={metrics.won} icon="🏆" accent="#16A34A" />
        <MetricCard label="Pipeline Value" value={`$${metrics.pipeline.toLocaleString()}`} icon="💰" accent={C.amber} />
      </div>

      {/* Recent proposals */}
      <Card padding="0">
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Recent Proposals</span>
          <span style={{ fontSize: 12, color: C.textSoft }}>{recent.length} of {proposals.length}</span>
        </div>
        {recent.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✦</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>No proposals yet</div>
            <div style={{ fontSize: 13, color: C.textSoft, marginBottom: 16 }}>Create your first AI-powered proposal</div>
            <Btn onClick={onNew} variant="outline">Get started →</Btn>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Project", "Client", "Score", "Est. Value", "Risk", "Created", ""].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.textSoft, letterSpacing: ".04em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((p, i) => (
                <TableRow key={p.id} p={p} onOpen={onOpen} isLast={i === recent.length - 1} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function TableRow({ p, onOpen, onDelete, isLast }) {
  const [hov, setHov] = useState(false);
  const sc = SCORE_CONFIG[p.score];
  const rc = RISK_CONFIG[p.riskFlag];
  return (
    <tr style={{ borderBottom: isLast ? "none" : `1px solid ${C.border}`, background: hov ? C.bg : "transparent", transition: "background .1s", cursor: "pointer" }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={() => onOpen(p)}>
      <td style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
      </td>
      <td style={{ padding: "12px 16px", fontSize: 13, color: C.textMid }}>{p.clientName || "—"}</td>
      <td style={{ padding: "12px 16px" }}>{sc ? <Tag label={p.score} config={sc} /> : "—"}</td>
      <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: C.accent }}>{p.estimatedValue ? `$${Number(p.estimatedValue).toLocaleString()}` : "—"}</td>
      <td style={{ padding: "12px 16px" }}>{rc && p.riskFlag ? <Tag label={p.riskFlag} config={rc} /> : "—"}</td>
      <td style={{ padding: "12px 16px", fontSize: 12, color: C.textSoft }}>{relTime(p.createdAt)}</td>
      <td style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" variant="secondary" onClick={e => { e.stopPropagation(); onOpen(p); }}>Open</Btn>
          {onDelete && <Btn size="sm" variant="danger" onClick={e => { e.stopPropagation(); onDelete(p.id); }}>Delete</Btn>}
        </div>
      </td>
    </tr>
  );
}

// ── Wizard Shell ───────────────────────────────────────────────────────────
const STEPS = [
  { n: 1, label: "Lead Input",    short: "Input" },
  { n: 2, label: "AI Analysis",   short: "Analysis" },
  { n: 3, label: "Proposal",      short: "Proposal" },
  { n: 4, label: "AI Editing",    short: "Edit" },
  { n: 5, label: "Preview",       short: "Preview" },
];

function WizardShell({ state, setState, settings, onFinish, onCancel }) {
  const { step, data } = state;
  const setStep = (s) => setState(prev => ({ ...prev, step: s }));
  const setData = (d) => setState(prev => ({ ...prev, data: d }));

  return (
    <div className="apg-in" style={{ maxWidth: 800, margin: "0 auto", padding: "32px 36px" }}>
      {/* Step progress */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 20px", boxShadow: C.shadow }}>
          {STEPS.map((s, i) => (
            <div key={s.n} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                  background: step > s.n ? C.accent : step === s.n ? C.accent : C.surfaceAlt,
                  border: `2px solid ${step >= s.n ? C.accent : C.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                  color: step >= s.n ? "#fff" : C.textSoft,
                  transition: "all .25s" }}>
                  {step > s.n ? "✓" : s.n}
                </div>
                <span style={{ fontSize: 12, fontWeight: step === s.n ? 600 : 400, color: step === s.n ? C.accent : step > s.n ? C.textMid : C.textSoft, whiteSpace: "nowrap" }}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 1.5, background: step > s.n ? C.accentMid : C.border, margin: "0 10px", transition: "background .3s", borderRadius: 1 }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {step === 1 && <Step1 data={data} settings={settings} onNext={d => { setData(d); setStep(2); }} onCancel={onCancel} />}
      {step === 2 && <Step2 data={data} settings={settings} onNext={d => { setData(d); setStep(3); }} onBack={() => setStep(1)} />}
      {step === 3 && <Step3 data={data} onNext={d => { setData(d); setStep(4); }} onBack={() => setStep(2)} />}
      {step === 4 && <Step4 data={data} settings={settings} onNext={d => { setData(d); setStep(5); }} onBack={() => setStep(3)} />}
      {step === 5 && <Step5 data={data} settings={settings} onSave={onFinish} onBack={() => setStep(4)} />}
    </div>
  );
}

// ── Step 1 ─────────────────────────────────────────────────────────────────
function Step1({ data, settings, onNext, onCancel }) {
  const [form, setForm] = useState({
    id: data?.id || uid(), clientName: data?.clientName || "", title: data?.title || "",
    budget: data?.budget || "", description: data?.description || "",
    questions: data?.questions || "", figmaLink: data?.figmaLink || "",
    createdAt: data?.createdAt || Date.now(),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleAnalyze = async () => {
    if (!form.title || !form.description) { setErr("Project Title and Description are required."); return; }
    setBusy(true); setErr("");
    try {
      const analysis = await analyzeRequirements({
        title: form.title, description: form.description,
        budget: form.budget, questions: form.questions,
      });
      onNext({ ...form, analysis });
    } catch (e) { setErr(`Analysis failed: ${e.message}`); }
    setBusy(false);
  };

  return (
    <div>
      <SectionHeader eyebrow="Step 1 of 5" title="Lead Input" subtitle="Enter client and project details. The AI will analyze requirements in the next step." />
      {err && <div style={{ background: C.dangerLight, border: `1px solid ${C.danger}30`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 20 }}>{err}</div>}
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <TextInput label="Client Name" name="clientName" value={form.clientName} onChange={set} placeholder="e.g. Acme Corp" optional />
            <TextInput label="Project Title" name="title" value={form.title} onChange={set} placeholder="e.g. E-Commerce Platform" required />
          </div>
          <TextInput label="Budget" name="budget" value={form.budget} onChange={set} placeholder="e.g. $10,000 – $20,000" optional hint="Leave blank if not specified by the client" />
          <TextArea label="Project Description" name="description" value={form.description} onChange={set} placeholder="Paste the full Upwork job description or client brief here..." rows={7} required hint="The more detail, the better the AI analysis" />
          <TextArea label="Client Screening Questions" name="questions" value={form.questions} onChange={set} placeholder="Any specific questions the client asked in the job post..." rows={3} optional />
          <TextInput label="Figma / Design Link" name="figmaLink" value={form.figmaLink} onChange={set} placeholder="https://figma.com/file/..." optional />
        </div>
      </Card>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" size="lg" onClick={handleAnalyze} disabled={busy || !form.title || !form.description}>
          {busy ? <><Spinner size={14} color="#fff" /> Analyzing...</> : "Analyze Requirements →"}
        </Btn>
      </div>
    </div>
  );
}

// ── Step 2 ─────────────────────────────────────────────────────────────────
function Step2({ data, settings, onNext, onBack }) {
  const [busy, setBusy] = useState(false);
  const a = data?.analysis || {};

  const Pill = ({ label }) => (
    <span style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, color: C.textMid, display: "inline-block" }}>{label}</span>
  );
  const PillGroup = ({ title, items = [] }) => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.length ? items.map((x, i) => <Pill key={i} label={x} />) : <span style={{ fontSize: 12, color: C.textSoft }}>None identified</span>}
      </div>
    </div>
  );

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const proposal = await generateProposal({
        title: data.title, clientName: data.clientName,
        description: data.description, budget: data.budget, analysis: a,
      });
      onNext({ ...data, proposal });
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const StatItem = ({ label, value, color }) => (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: C.textSoft, fontWeight: 500, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || C.text }}>{value || "—"}</div>
    </div>
  );

  return (
    <div>
      <SectionHeader eyebrow="Step 2 of 5" title="Requirement Analysis" subtitle="AI-extracted project structure, complexity assessment, and lead classification." />
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <StatItem label="Complexity" value={a.complexity} color={a.complexity === "Very High" ? C.danger : a.complexity === "High" ? C.amber : C.accent} />
        <StatItem label="Est. Dev Hours" value={a.estimatedHours ? `${a.estimatedHours}h` : "—"} color={C.blue} />
        <StatItem label="Lead Score" value={a.score} color={SCORE_CONFIG[a.score]?.color} />
        <StatItem label="Risk Level" value={a.riskFlag} color={RISK_CONFIG[a.riskFlag]?.color} />
      </div>
      {a.scopeNote && (
        <div style={{ background: C.amberLight, border: `1px solid ${C.amber}30`, borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 13, color: C.amber, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ flexShrink: 0 }}>⚠</span><span>{a.scopeNote}</span>
        </div>
      )}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <PillGroup title="Modules" items={a.modules} />
          <div style={{ height: 1, background: C.border }} />
          <PillGroup title="Features" items={a.features} />
          <div style={{ height: 1, background: C.border }} />
          <PillGroup title="Integrations" items={a.integrations} />
        </div>
      </Card>
      {a.scoreReason && (
        <div style={{ background: SCORE_CONFIG[a.score]?.bg || C.accentLight, border: `1px solid ${SCORE_CONFIG[a.score]?.color || C.accent}25`, borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 13, color: SCORE_CONFIG[a.score]?.color || C.accent }}>
          <strong>Lead Insight:</strong> {a.scoreReason}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn variant="secondary" onClick={onBack}>← Back</Btn>
        <Btn variant="primary" size="lg" onClick={handleGenerate} disabled={busy}>
          {busy ? <><Spinner size={14} color="#fff" /> Generating...</> : "Generate Proposal →"}
        </Btn>
      </div>
    </div>
  );
}

// ── Step 3 ─────────────────────────────────────────────────────────────────
function Step3({ data, onNext, onBack }) {
  return (
    <div>
      <SectionHeader eyebrow="Step 3 of 5" title="Generated Proposal" subtitle="Review your AI-generated proposal. Proceed to refine it with the AI editor." />
      <Card style={{ marginBottom: 20 }}>
        <div className="apg-prose" dangerouslySetInnerHTML={{ __html: mdToHtml(data?.proposal || "No proposal generated.") }} />
      </Card>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn variant="secondary" onClick={onBack}>← Back</Btn>
        <Btn variant="primary" size="lg" onClick={() => onNext(data)}>Open AI Editor →</Btn>
      </div>
    </div>
  );
}

// ── Step 4 ─────────────────────────────────────────────────────────────────
function Step4({ data, settings, onNext, onBack }) {
  const [content, setContent] = useState(data?.proposal || "");
  const [aiPrompt, setAiPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const editorRef = useRef(null);

  // content state = source of truth (always valid markdown)
  const applyAI = async (action) => {
    const selected = window.getSelection()?.toString() || "";
    const target = selected || content;
    setBusy(true); setActiveAction(action);
    try {
      const isCustom = !["Rewrite","Expand","Shorten"].includes(action);
      const result = await editProposal({
        text: target,
        action: isCustom ? "custom" : action,
        customInstruction: isCustom ? action : undefined,
      });
      const newContent = selected ? content.replace(selected, result) : result;
      setContent(newContent);
      if (editorRef.current) editorRef.current.innerHTML = mdToHtml(newContent);
    } catch (e) { alert(e.message); }
    setBusy(false); setActiveAction(null);
  };

  return (
    <div>
      <SectionHeader eyebrow="Step 4 of 5" title="AI Editor" subtitle="Edit the proposal directly or use AI to refine specific sections." />
      {/* AI Toolbar */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", marginBottom: 16, boxShadow: C.shadow }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 10 }}>AI Actions</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {["Rewrite", "Expand", "Shorten"].map(a => (
            <Btn key={a} size="sm" variant="outline" onClick={() => applyAI(a)} disabled={busy}>
              {busy && activeAction === a ? <><Spinner size={11} color={C.accent} /> {a}...</> : a}
            </Btn>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
              placeholder='Custom instruction — e.g. "make the tone more formal" or "add a risk mitigation section"'
              onKeyDown={e => e.key === "Enter" && !busy && aiPrompt && applyAI(aiPrompt)}
              style={{ width: "100%", background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "inherit", color: C.text, outline: "none" }} />
          </div>
          <Btn size="sm" variant="primary" onClick={() => applyAI(aiPrompt)} disabled={busy || !aiPrompt}>Apply</Btn>
        </div>
        <div style={{ fontSize: 11, color: C.textSoft, marginTop: 8 }}>💡 Select specific text in the editor, then click an action to edit only that section</div>
      </div>

      {/* Editor — textarea for editing markdown, rendered preview below */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 20, boxShadow: C.shadow }}>
        <div style={{ background: C.bg, borderBottom: `1px solid ${C.border}`, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FC5353" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FDB000" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22C55E" }} />
          <span style={{ fontSize: 11, color: C.textSoft, marginLeft: 8 }}>Proposal Editor — edit markdown directly</span>
        </div>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          style={{ width: "100%", minHeight: 320, padding: "20px 24px", border: "none", outline: "none",
            fontFamily: "'Courier New', Courier, monospace", fontSize: 12.5, lineHeight: 1.8,
            color: "#1A1814", background: C.surface, resize: "vertical", boxSizing: "border-box" }}
          placeholder="Your proposal markdown will appear here..."
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn variant="secondary" onClick={onBack}>← Back</Btn>
        <Btn variant="primary" size="lg" onClick={() => onNext({ ...data, proposal: content })}>
          Preview Proposal →
        </Btn>
      </div>
    </div>
  );
}

// ── Step 5 ─────────────────────────────────────────────────────────────────
function Step5({ data, settings, onSave, onBack }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...data, status: "Draft", estimatedValue: data?.analysis?.estimatedValue || 0 });
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    }
    setSaving(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(data?.proposal || "");
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const sc = SCORE_CONFIG[data?.analysis?.score];
  const rc = RISK_CONFIG[data?.analysis?.riskFlag];

  return (
    <div>
      <SectionHeader eyebrow="Step 5 of 5" title="Proposal Preview" subtitle="Final review before saving. This is how your proposal will appear to clients." />
      {/* Meta bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {data?.analysis?.score && <Tag label={data.analysis.score} config={sc} />}
        {data?.analysis?.riskFlag && <Tag label={`${data.analysis.riskFlag} Risk`} config={rc} />}
        {data?.analysis?.estimatedValue && <Tag label={`Est. $${Number(data.analysis.estimatedValue).toLocaleString()}`} config={{ color: C.accent, bg: C.accentLight }} />}
        {data?.budget && <Tag label={`Budget: ${data.budget}`} config={{ color: C.textMid, bg: C.surfaceAlt }} />}
      </div>

      {/* Preview card */}
      <div style={{ background: C.surface, borderRadius: 14, overflow: "hidden", boxShadow: C.shadowLg, marginBottom: 20, border: `1px solid ${C.border}` }}>
        {/* Letterhead */}
        <div style={{ background: `linear-gradient(135deg, #1A3A2E, ${C.accent})`, padding: "28px 32px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-.02em", marginBottom: 4 }}>{settings.companyName}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", letterSpacing: ".04em" }}>{settings.companyTagline}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "rgba(255,255,255,.7)", lineHeight: 1.8 }}>
            <div>{new Date().toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}</div>
            <div>Prepared for: <span style={{ color: "#fff", fontWeight: 600 }}>{data?.clientName || "Client"}</span></div>
          </div>
        </div>
        {/* Accent stripe */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${C.accentMid}, #95D5B2)` }} />
        {/* Content */}
        <div style={{ padding: "32px 36px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 24, letterSpacing: "-.02em" }}>{data?.title}</h1>
          <div className="apg-prose-preview" dangerouslySetInnerHTML={{ __html: mdToHtml(data?.proposal || "") }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <Btn variant="secondary" onClick={onBack}>← Back to Editor</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" onClick={handleCopy} icon="⎘">{copied ? "Copied!" : "Copy Text"}</Btn>
          <Btn variant="primary" size="lg" onClick={handleSave} disabled={saving}>
            {saving ? <><Spinner size={14} color="#fff" /> Saving...</> : "✓ Save Proposal"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── History ────────────────────────────────────────────────────────────────
function History({ proposals, onOpen, onDelete }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const filtered = proposals.filter(p => {
    const q = search.toLowerCase();
    return (p.title?.toLowerCase().includes(q) || p.clientName?.toLowerCase().includes(q)) &&
           (filter === "All" || p.score === filter);
  });

  return (
    <div className="apg-in" style={{ padding: "32px 36px", maxWidth: 980, margin: "0 auto" }}>
      <SectionHeader eyebrow="Proposals" title="History" subtitle="Search, review, and manage all past proposals." />
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.textSoft, fontSize: 13 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or client..."
            style={{ width: "100%", background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "9px 12px 9px 32px", fontSize: 13, fontFamily: "inherit", color: C.text, outline: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["All", "Strategic", "Revenue", "Cash"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ background: filter === f ? C.accent : C.surface, color: filter === f ? "#fff" : C.textMid, border: `1px solid ${filter === f ? C.accent : C.border}`, borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", transition: "all .15s" }}>
              {f}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px", color: C.textSoft, fontSize: 13 }}>No proposals found</div>
      ) : (
        <Card padding="0">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Project", "Client", "Score", "Value", "Risk", "Created", ""].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.textSoft, letterSpacing: ".04em", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((p, i) => (
                <TableRow key={p.id} p={p} onOpen={onOpen} onDelete={onDelete} isLast={i === filtered.length - 1} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── Portfolio ──────────────────────────────────────────────────────────────

const CATEGORIES = ["Healthcare","E-Commerce","SaaS","FinTech","AI/ML","Mobile","Education","Real Estate","Other"];

function getYouTubeId(url = "") {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
  return m ? m[1] : null;
}

function YouTubeThumb({ url, onRemove }) {
  const id = getYouTubeId(url);
  return (
    <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", background: "#000", aspectRatio: "16/9" }}>
      {id
        ? <img src={`https://img.youtube.com/vi/${id}/mqdefault.jpg`} alt="thumb"
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: .85 }} />
        : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#fff", fontSize: 11 }}>Invalid URL</div>
      }
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={() => window.open(url, "_blank")} style2={{ cursor: "pointer" }}>
        {id && <div style={{ width: 36, height: 36, background: "rgba(255,0,0,.85)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          onClick={e => { e.stopPropagation(); window.open(url, "_blank"); }}>
          <span style={{ color: "#fff", fontSize: 13, marginLeft: 3 }}>▶</span>
        </div>}
      </div>
      <button onClick={onRemove}
        style={{ position: "absolute", top: 5, right: 5, background: "rgba(0,0,0,.65)", color: "#fff",
          border: "none", borderRadius: "50%", width: 22, height: 22, cursor: "pointer",
          fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>✕</button>
      <div style={{ fontSize: 9, color: "#aaa", padding: "2px 6px", background: "rgba(0,0,0,.5)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</div>
    </div>
  );
}

function YoutubeLinksManager({ links, onChange }) {
  const [input, setInput] = useState("");
  const [err, setErr]     = useState("");
  const add = () => {
    const url = input.trim();
    if (!url) return;
    if (!url.includes("youtube") && !url.includes("youtu.be")) { setErr("Must be a YouTube URL"); return; }
    if (links.includes(url)) { setErr("Already added"); return; }
    onChange([...links, url]); setInput(""); setErr("");
  };
  const remove = (url) => onChange(links.filter(l => l !== url));
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>
        YouTube Videos <span style={{ fontWeight: 400, color: C.textSoft, fontSize: 11 }}>— add as many as you like</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <input value={input} onChange={e => { setInput(e.target.value); setErr(""); }}
          onKeyDown={e => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="https://youtu.be/... or https://youtube.com/watch?v=..."
          style={{ flex: 1, background: C.surface, border: `1.5px solid ${err ? C.danger : C.border}`,
            borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "inherit",
            color: C.text, outline: "none" }} />
        <Btn size="sm" variant="outline" onClick={add}>＋ Add</Btn>
      </div>
      {err && <div style={{ fontSize: 11, color: C.danger, marginBottom: 6 }}>{err}</div>}
      {links.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginTop: 6 }}>
          {links.map((url, i) => <YouTubeThumb key={i} url={url} onRemove={() => remove(url)} />)}
        </div>
      )}
    </div>
  );
}

function MediaUploadZone({ projectId, media, onMediaChange }) {
  const [dragging, setDragging]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState([]);
  const inputRef = useRef(null);

  const doUpload = async (files) => {
    if (!projectId) { alert("Save the project first, then upload files."); return; }
    setUploading(true);
    const prog = Array.from(files).map(f => ({ name: f.name, status: "uploading" }));
    setProgress(prog);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("files", f));
      const res  = await fetch(`${API_BASE}/api/portfolio/${projectId}/media`, { method: "POST", body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setProgress(prog.map(p => ({ ...p, status: "done" })));
      onMediaChange([...media, ...data.media]);
    } catch (e) {
      setProgress(prog.map(p => ({ ...p, status: "error" })));
      alert("Upload failed: " + e.message);
    }
    setTimeout(() => { setUploading(false); setProgress([]); }, 1500);
  };

  const deleteMedia = async (id) => {
    const row = media.find(m => m.id === id);
    if (!row) return;
    try {
      await apiCall(`/api/portfolio/${projectId}/media/${id}`, "DELETE");
      onMediaChange(media.filter(m => m.id !== id));
    } catch (e) { alert("Delete failed: " + e.message); }
  };

  const images      = media.filter(m => m.type === "image");
  const attachments = media.filter(m => m.type === "attachment");
  const fileIcon = (mime = "") => mime.includes("pdf") ? "📄" : mime.includes("word") ? "📝" : mime.includes("video") ? "🎬" : "📎";
  const fmtSize = b => !b ? "" : b < 1048576 ? `${(b/1024).toFixed(0)}KB` : `${(b/1048576).toFixed(1)}MB`;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>
        Images & File Attachments <span style={{ fontWeight: 400, color: C.textSoft, fontSize: 11 }}>— PDFs, Word docs, images, videos. Multiple allowed.</span>
      </div>
      {/* Drop zone */}
      <div onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); doUpload(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{ border: `2px dashed ${dragging ? C.accent : C.border}`, borderRadius: 10,
          padding: "22px 16px", textAlign: "center", background: dragging ? C.accentLight : C.bg,
          cursor: "pointer", transition: "all .2s", marginBottom: 10 }}>
        <input ref={inputRef} type="file" multiple style={{ display: "none" }}
          accept="image/*,.pdf,.doc,.docx,video/mp4,video/quicktime"
          onChange={e => doUpload(e.target.files)} />
        <div style={{ fontSize: 22, marginBottom: 6 }}>{uploading ? "⏳" : dragging ? "📂" : "☁️"}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{uploading ? "Uploading..." : "Drop files or click to browse"}</div>
        <div style={{ fontSize: 11, color: C.textSoft, marginTop: 2 }}>Images, PDFs, Word docs, videos</div>
      </div>

      {/* Upload progress */}
      {progress.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
          {progress.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surfaceAlt,
              borderRadius: 6, padding: "5px 10px", fontSize: 11 }}>
              <span>{p.status === "done" ? "✓" : p.status === "error" ? "✕" : "⏳"}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.textMid }}>{p.name}</span>
              <span style={{ color: p.status === "done" ? C.accent : p.status === "error" ? C.danger : C.textSoft }}>{p.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Image grid */}
      {images.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textSoft, letterSpacing: ".06em",
            textTransform: "uppercase", marginBottom: 6 }}>Images ({images.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 6 }}>
            {images.map(m => (
              <div key={m.id} style={{ position: "relative", borderRadius: 7, overflow: "hidden",
                aspectRatio: "1", background: C.surfaceAlt }}>
                {m.blob_url
                  ? <img src={m.blob_url} alt={m.original_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 20 }}>🖼</div>
                }
                <button onClick={() => deleteMedia(m.id)}
                  style={{ position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,.6)", color: "#fff",
                    border: "none", borderRadius: "50%", width: 18, height: 18, cursor: "pointer", fontSize: 9,
                    display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textSoft, letterSpacing: ".06em",
            textTransform: "uppercase", marginBottom: 6 }}>Attachments ({attachments.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {attachments.map(m => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8,
                background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px" }}>
                <span style={{ fontSize: 16 }}>{fileIcon(m.mime_type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: C.text, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.original_name}</div>
                  <div style={{ fontSize: 10, color: C.textSoft }}>{fmtSize(m.size_bytes)}</div>
                </div>
                {m.blob_url && <a href={m.blob_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11, color: C.accent, textDecoration: "none" }}>↗</a>}
                <button onClick={() => deleteMedia(m.id)}
                  style={{ background: "none", border: "none", color: C.danger, cursor: "pointer", fontSize: 13, padding: 2 }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Portfolio({ portfolio, onReload }) {
  const EMPTY = {
    title: "", category: "", description: "", problemSolved: "",
    solution: "", outcome: "", techStack: "", clientName: "",
    clientTestimonial: "", youtubeLinks: [], websiteUrl: "",
  };

  const [view, setView]       = useState("list"); // "list" | "form"
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState(EMPTY);
  const [media, setMedia]     = useState([]);
  const [saving, setSaving]   = useState(false);
  const [savedId, setSavedId] = useState(null);

  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const openNew = () => { setEditing(null); setForm(EMPTY); setMedia([]); setSavedId(null); setView("form"); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      title: p.title || "", category: p.category || "",
      description: p.description || "", problemSolved: p.problem_solved || "",
      solution: p.solution || "", outcome: p.outcome || "",
      techStack: p.tech_stack || "", clientName: p.client_name || "",
      clientTestimonial: p.client_testimonial || "",
      youtubeLinks: p.youtube_links || [], websiteUrl: p.website_url || "",
    });
    setMedia(p.media || []);
    setSavedId(p.id);
    setView("form");
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title, category: form.category, description: form.description,
        problemSolved: form.problemSolved, solution: form.solution, outcome: form.outcome,
        techStack: form.techStack, clientName: form.clientName,
        clientTestimonial: form.clientTestimonial, youtubeLinks: form.youtubeLinks,
        websiteUrl: form.websiteUrl,
      };
      let data;
      if (editing) {
        data = await apiCall(`/api/portfolio/${editing.id}`, "PUT", payload);
      } else {
        data = await apiCall("/api/portfolio", "POST", payload);
      }
      setSavedId(data.project.id);
      if (!editing) setEditing(data.project);
      await onReload();
    } catch (e) { alert("Save failed: " + e.message); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this project and all its media?")) return;
    try { await apiCall(`/api/portfolio/${id}`, "DELETE"); await onReload(); }
    catch (e) { alert("Delete failed: " + e.message); }
  };

  const Divider = ({ label }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 2px" }}>
      <div style={{ flex: 1, height: 1, background: C.border }} />
      <span style={{ fontSize: 10, fontWeight: 700, color: C.textSoft, letterSpacing: ".08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );

  // ── LIST ──────────────────────────────────────────────────────────────────
  if (view === "list") return (
    <div className="apg-in" style={{ padding: "32px 36px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28, gap: 16 }}>
        <div>
          <SectionHeader eyebrow="Portfolio" title="Portfolio Manager"
            subtitle="Past projects used as AI context. Richer data = better proposals." />
        </div>
        <Btn variant="primary" size="lg" onClick={openNew} icon="＋">Add Project</Btn>
      </div>

      {portfolio.length === 0 ? (
        <div style={{ background: C.surface, border: `2px dashed ${C.border}`, borderRadius: 14,
          padding: "64px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>No projects yet</div>
          <div style={{ fontSize: 13, color: C.textSoft, marginBottom: 20 }}>
            Add past work — the AI references it when generating proposals for similar clients.
          </div>
          <Btn variant="outline" onClick={openNew}>Add your first project →</Btn>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 16 }}>
          {portfolio.map(p => {
            const images  = (p.media || []).filter(m => m.type === "image");
            const files   = (p.media || []).filter(m => m.type === "attachment");
            const ytLinks = p.youtube_links || [];
            const thumb   = images[0]?.blob_url || (ytLinks[0] ? `https://img.youtube.com/vi/${getYouTubeId(ytLinks[0])}/mqdefault.jpg` : null);
            return (
              <Card key={p.id} style={{ overflow: "hidden" }} padding="0">
                {thumb && (
                  <div style={{ height: 130, overflow: "hidden", background: C.surfaceAlt }}>
                    <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                )}
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 }}>{p.title}</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {p.category && <Tag label={p.category} config={{ color: C.accent, bg: C.accentLight }} />}
                        {p.client_name && <span style={{ fontSize: 11, color: C.textSoft }}>{p.client_name}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                      <Btn size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Btn>
                      <Btn size="sm" variant="danger" onClick={() => handleDelete(p.id)}>✕</Btn>
                    </div>
                  </div>
                  {p.description && <p style={{ fontSize: 11, color: C.textMid, lineHeight: 1.6, marginBottom: 8 }}>
                    {p.description.length > 120 ? p.description.slice(0, 120) + "..." : p.description}
                  </p>}
                  {p.client_testimonial && (
                    <div style={{ background: C.accentLight, borderLeft: `3px solid ${C.accent}`,
                      padding: "6px 10px", borderRadius: "0 5px 5px 0", marginBottom: 8,
                      fontSize: 11, color: C.accent, fontStyle: "italic" }}>
                      "{p.client_testimonial.slice(0, 90)}{p.client_testimonial.length > 90 ? "..." : ""}"
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {ytLinks.length > 0 && <span style={{ fontSize: 10, color: C.textSoft }}>▶ {ytLinks.length} video{ytLinks.length > 1 ? "s" : ""}</span>}
                    {images.length > 0 && <span style={{ fontSize: 10, color: C.textSoft }}>🖼 {images.length}</span>}
                    {files.length > 0 && <span style={{ fontSize: 10, color: C.textSoft }}>📎 {files.length}</span>}
                    {p.tech_stack && <span style={{ fontSize: 10, color: C.textSoft, marginLeft: "auto" }}>{p.tech_stack}</span>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── FORM ──────────────────────────────────────────────────────────────────
  return (
    <div className="apg-in" style={{ padding: "32px 36px", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={() => { setView("list"); onReload(); }}
          style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: "7px 14px", fontSize: 13, color: C.textMid, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>
          ← Back
        </button>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
            {editing ? `Editing: ${editing.title}` : "Add New Project"}
          </div>
          <div style={{ fontSize: 12, color: savedId ? C.accent : C.textSoft, marginTop: 2 }}>
            {savedId ? "✓ Project saved — you can now upload media" : "Fill in details and save to enable media uploads"}
          </div>
        </div>
      </div>

      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          <Divider label="Basic Info" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <TextInput label="Project Title" name="title" value={form.title} onChange={set}
              placeholder="e.g. Companion Scribe AI" required />
            <TextInput label="Client Name" name="clientName" value={form.clientName} onChange={set}
              placeholder="e.g. Acme Healthcare" optional />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>Category</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => setForm(f => ({ ...f, category: c }))}
                  style={{ background: form.category === c ? C.accent : C.surfaceAlt,
                    color: form.category === c ? "#fff" : C.textMid,
                    border: `1px solid ${form.category === c ? C.accent : C.border}`,
                    borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
                    cursor: "pointer", transition: "all .15s", fontFamily: "inherit" }}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <TextInput label="Tech Stack" name="techStack" value={form.techStack} onChange={set}
              placeholder="React, Node.js, Azure..." optional />
            <TextInput label="Website URL" name="websiteUrl" value={form.websiteUrl} onChange={set}
              placeholder="https://..." optional />
          </div>

          <Divider label="Project Story — Helps AI Write Better Proposals" />
          <TextArea label="Project Description" name="description" value={form.description} onChange={set}
            rows={3} placeholder="Brief overview of what was built and for whom..."
            hint="Primary text the AI matches against new job leads" optional />
          <TextArea label="Problem Solved" name="problemSolved" value={form.problemSolved} onChange={set}
            rows={2} placeholder="What challenge did the client face?" optional />
          <TextArea label="Our Solution" name="solution" value={form.solution} onChange={set}
            rows={2} placeholder="What did we build to solve it?" optional />
          <TextArea label="Outcome / Results" name="outcome" value={form.outcome} onChange={set}
            rows={2} placeholder="Measurable results e.g. reduced documentation time by 70%..." optional
            hint="Concrete outcomes make proposals significantly more persuasive" />

          <Divider label="Client Voice" />
          <TextArea label="Client Testimonial" name="clientTestimonial" value={form.clientTestimonial} onChange={set}
            rows={3} placeholder='"The platform transformed how our team works. Highly recommend CSharpTek."'
            optional hint="Quoted directly in the Relevant Experience section of proposals" />

          <Divider label="Media — Videos, Images & Files" />
          <YoutubeLinksManager
            links={form.youtubeLinks}
            onChange={links => setForm(f => ({ ...f, youtubeLinks: links }))} />
          <MediaUploadZone projectId={savedId} media={media} onMediaChange={setMedia} />

        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        marginTop: 16, padding: "14px 18px", background: C.surface,
        border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadowMd }}>
        <div style={{ fontSize: 12, color: savedId ? C.accent : C.textSoft, fontWeight: savedId ? 600 : 400 }}>
          {savedId ? "✓ Saved — media uploads enabled" : "Save first to enable media uploads"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="secondary" onClick={() => { setView("list"); onReload(); }}>Cancel</Btn>
          <Btn variant="primary" size="lg" onClick={handleSave} disabled={saving || !form.title.trim()}>
            {saving ? "Saving..." : savedId ? "Update Project" : "Save Project"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────
function SettingsPage({ settings, onSave }) {
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  // Step 1: Save to backend DB first
  const handleSave = async () => {
    setSaving(true); setTestResult(null);
    try {
      await apiCall("/api/settings", "POST", form);
      onSave(form); // update local React state
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      alert(`Save failed: ${e.message}

Make sure your backend is running at ${API_BASE}`);
    }
    setSaving(false);
  };

  // Step 2: Test — backend reads from DB and calls Azure itself (no CORS)
  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const data = await apiCall("/api/settings/test", "POST");
      setTestResult({ ok: true, msg: data.message });
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  };

  const SettingsGroup = ({ title, description, children }) => (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{title}</div>
        {description && <div style={{ fontSize: 12, color: C.textSoft, marginTop: 3 }}>{description}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </Card>
  );

  return (
    <div className="apg-in" style={{ padding: "32px 36px", maxWidth: 660, margin: "0 auto" }}>
      <SectionHeader eyebrow="Settings" title="Configuration" subtitle="Set up your Azure services, company branding, and API credentials." />
      <SettingsGroup title="Company Information" description="Used in proposal letterheads and previews">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <TextInput label="Company Name" name="companyName" value={form.companyName} onChange={set} placeholder="CSharpTek" />
          <TextInput label="Tagline" name="companyTagline" value={form.companyTagline} onChange={set} placeholder="Software Consulting" />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Azure OpenAI" description="Required for AI proposal generation and analysis">
        <TextInput label="Endpoint" name="azureEndpoint" value={form.azureEndpoint} onChange={set} placeholder="https://your-resource.openai.azure.com" />
        <TextInput label="API Key" name="azureKey" value={form.azureKey} onChange={set} placeholder="••••••••••••••••" type="password" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <TextInput label="Deployment Name" name="azureDeployment" value={form.azureDeployment} onChange={set} placeholder="gpt-4o" />
          <TextInput label="API Version" name="azureApiVersion" value={form.azureApiVersion} onChange={set} placeholder="2024-02-15-preview" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Btn size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <><Spinner size={11} color={C.accent} /> Testing...</> : "Test Connection"}
          </Btn>
          {testResult && (
            <span style={{ fontSize: 12, fontWeight: 600, color: testResult.ok ? "#16A34A" : C.danger, display: "flex", alignItems: "center", gap: 5 }}>
              {testResult.ok ? "✓" : "✕"} {testResult.msg}
            </span>
          )}
        </div>
      </SettingsGroup>
      <SettingsGroup title="Azure AI Search" description="Optional — enables portfolio-based RAG for richer proposals">
        <TextInput label="Search Endpoint" name="azureSearchEndpoint" value={form.azureSearchEndpoint || ""} onChange={set} placeholder="https://...search.windows.net" optional />
        <TextInput label="Search API Key" name="azureSearchKey" value={form.azureSearchKey || ""} onChange={set} type="password" placeholder="••••••••••••••••" optional />
        <TextInput label="Index Name" name="azureSearchIndex" value={form.azureSearchIndex || ""} onChange={set} placeholder="proposals-index" optional />
      </SettingsGroup>
      <SettingsGroup title="Azure Blob Storage" description="Optional — for PDF storage and attachments">
        <TextInput label="Connection String" name="azureStorageConnection" value={form.azureStorageConnection || ""} onChange={set} type="password" placeholder="DefaultEndpointsProtocol=https;..." optional />
        <TextInput label="Container Name" name="azureStorageContainer" value={form.azureStorageContainer || ""} onChange={set} placeholder="proposals" optional />
      </SettingsGroup>
      <div style={{ background: C.accentLight, border: `1px solid ${C.accent}25`, borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: C.accent, fontWeight: 600, marginBottom: 4 }}>ℹ How this works</div>
        <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.65 }}>
          1. Fill in your Azure credentials and click <strong>Save Settings</strong> — stored securely in your database.<br/>
          2. Click <strong>Test Connection</strong> — your server reads the credentials from DB and contacts Azure directly (no CORS issues).
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn variant="primary" size="lg" onClick={handleSave} disabled={saving}>
          {saving ? <><Spinner size={14} color="#fff" /> Saving...</> : saved ? "✓ Saved!" : "Save Settings"}
        </Btn>
      </div>
    </div>
  );
}

// ── Global Styles ──────────────────────────────────────────────────────────
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      @keyframes apg-spin { to { transform: rotate(360deg); } }
      @keyframes apg-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      .apg-in { animation: apg-in .3s ease both; }
      ::-webkit-scrollbar { width: 4px; height: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #D4D1CA; border-radius: 4px; }

      /* Prose — dark editor */
      .apg-prose h1,.apg-prose h2,.apg-prose h3 { font-family:'Plus Jakarta Sans',sans-serif; font-weight:700; color:#1A1814; margin:1.3rem 0 .45rem; letter-spacing:-.01em; }
      .apg-prose h1 { font-size:1.15rem; } .apg-prose h2 { font-size:1rem; } .apg-prose h3 { font-size:.9rem; }
      .apg-prose p { font-size:.85rem; line-height:1.85; color:#4A4740; margin:.4rem 0; }
      .apg-prose strong { color:#1A1814; font-weight:600; }
      .apg-prose ul { padding-left:1.3rem; margin:.4rem 0; } .apg-prose li { font-size:.85rem; line-height:1.75; color:#4A4740; margin:.2rem 0; }
      .apg-prose blockquote { border-left:3px solid #2D6A4F; padding-left:.9rem; margin:.75rem 0; color:#6B6760; font-size:.82rem; font-style:italic; background:#EAF2EE; padding:.6rem .9rem; border-radius:0 6px 6px 0; }
      .apg-prose table { width:100%; border-collapse:collapse; margin:1.1rem 0; font-size:.82rem; border-radius:8px; overflow:hidden; }
      .apg-prose th { background:#1A3A2E; color:#fff; font-weight:600; padding:.6rem .9rem; text-align:left; font-size:.75rem; letter-spacing:.04em; text-transform:uppercase; }
      .apg-prose td { padding:.55rem .9rem; border-bottom:1px solid #E8E6E1; color:#4A4740; }
      .apg-prose tr:last-child td { background:#F3F2EF; font-weight:600; color:#1A1814; border-bottom:none; }

      /* Prose — preview (same but lighter headers) */
      .apg-prose-preview h1,.apg-prose-preview h2,.apg-prose-preview h3 { font-family:'Plus Jakarta Sans',sans-serif; font-weight:700; color:#1A1814; margin:1.3rem 0 .45rem; letter-spacing:-.01em; }
      .apg-prose-preview h1 { font-size:1.1rem; } .apg-prose-preview h2 { font-size:.95rem; color:#2D6A4F; } .apg-prose-preview h3 { font-size:.88rem; }
      .apg-prose-preview p { font-size:.84rem; line-height:1.85; color:#4A4740; margin:.35rem 0; }
      .apg-prose-preview strong { color:#1A1814; font-weight:600; }
      .apg-prose-preview ul { padding-left:1.3rem; margin:.4rem 0; } .apg-prose-preview li { font-size:.84rem; line-height:1.75; color:#4A4740; margin:.18rem 0; }
      .apg-prose-preview blockquote { border-left:3px solid #2D6A4F; padding:.6rem .9rem; margin:.75rem 0; color:#6B6760; font-size:.8rem; background:#EAF2EE; border-radius:0 6px 6px 0; }
      .apg-prose-preview table { width:100%; border-collapse:collapse; margin:1.1rem 0; font-size:.81rem; }
      .apg-prose-preview th { background:#1A3A2E; color:#fff; font-weight:600; padding:.55rem .9rem; text-align:left; font-size:.72rem; letter-spacing:.04em; text-transform:uppercase; }
      .apg-prose-preview td { padding:.5rem .9rem; border-bottom:1px solid #E8E6E1; color:#4A4740; }
      .apg-prose-preview tr:last-child td { background:#F3F2EF; font-weight:600; color:#1A1814; border-bottom:none; }
    `}</style>
  );
}
