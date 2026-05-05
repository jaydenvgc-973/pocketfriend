/**
 * SupportAssistant — Account Help & Repair
 *
 * Available to ALL logged-in users. Scoped exclusively to owner_email.
 * Never uses created_by. Never accesses another user's data.
 * Never calls deprecated or removed functions.
 * Uses only the current live backend function list.
 *
 * Diagnostic flow:
 *  1. User describes issue (or picks a category)
 *  2. Assistant runs read-only owner_email-scoped checks
 *  3. Shows visible findings — never hides broken records
 *  4. Offers safe repair actions with confirmation
 *  5. Reports status: received → diagnosing → needs repair → fixed / blocked
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HelpCircle, Send, Loader2, User, Brain, RefreshCw,
  CheckCircle2, AlertCircle, AlertTriangle, ChevronRight,
  GitMerge, Search, Wrench, MessageSquare, MapPin, DollarSign
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import ReactMarkdown from "react-markdown";

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// ── Issue category quick-picks ─────────────────────────────────────────────
const QUICK_ISSUES = [
  { id: "duplicates",  icon: GitMerge,      label: "Duplicate characters",    color: "text-amber-400"  },
  { id: "ghost",       icon: Search,        label: "Ghost or broken records",  color: "text-orange-400" },
  { id: "chat",        icon: MessageSquare, label: "Missing chats/messages",   color: "text-sky-400"    },
  { id: "location",    icon: MapPin,        label: "Location/travel issues",   color: "text-emerald-400"},
  { id: "money",       icon: DollarSign,    label: "Balance/finance errors",   color: "text-green-400"  },
  { id: "other",       icon: Wrench,        label: "Something else",           color: "text-primary"    },
];

// ── Live owner_email-scoped diagnostics ────────────────────────────────────
async function runOwnerScopedDiagnostic(ownerEmail) {
  const out = { ownerEmail, timestamp: new Date().toISOString(), checks: {} };

  // Characters — strict owner_email filter, no fallback
  try {
    const chars = await base44.entities.Character.filter(
      { owner_email: ownerEmail }, "-created_date", 500
    );
    const live = chars.filter(c =>
      c.status !== "deleted" && c.status !== "soft_deleted" && c.status !== "merged"
    );
    const missingOwnerEmail = chars.filter(c => !c.owner_email);
    const missingType = live.filter(c => !c.character_type);

    // Duplicate detection by name (case-insensitive)
    const nameMap = new Map();
    live.forEach(c => {
      const k = (c.name || "").trim().toLowerCase();
      if (!nameMap.has(k)) nameMap.set(k, []);
      nameMap.get(k).push(c);
    });
    const dupeGroups = [];
    nameMap.forEach((recs, name) => {
      if (recs.length >= 2) dupeGroups.push({ name, count: recs.length, ids: recs.map(r => r.id) });
    });

    out.checks.characters = {
      status: dupeGroups.length > 0 || missingOwnerEmail.length > 0 || missingType.length > 0 ? "warning" : "ok",
      total: chars.length,
      live: live.length,
      dupeGroups,
      missingOwnerEmail: missingOwnerEmail.length,
      missingType: missingType.length,
    };
  } catch (e) {
    out.checks.characters = { status: "error", error: e.message };
  }

  // Conversations — owner_email scoped
  try {
    const convs = await base44.entities.Conversation.filter({ owner_email: ownerEmail }, "-created_date", 100);
    out.checks.conversations = { status: "ok", total: convs.length };
  } catch (e) {
    out.checks.conversations = { status: "error", error: e.message };
  }

  // UserSettings — verify owner_email record exists
  try {
    const settings = await base44.entities.UserSettings.filter({ owner_email: ownerEmail });
    out.checks.settings = {
      status: settings.length === 1 ? "ok" : settings.length === 0 ? "warning" : "warning",
      count: settings.length,
      note: settings.length === 0 ? "No settings record found" : settings.length > 1 ? "Multiple settings records — may need consolidation" : null,
    };
  } catch (e) {
    out.checks.settings = { status: "error", error: e.message };
  }

  return out;
}

// ── Classify issue from free text ──────────────────────────────────────────
function classifyIssue(text) {
  const t = text.toLowerCase();
  if (/duplic|same.*twice|two.*of|double/i.test(t)) return "duplicates";
  if (/ghost|phantom|missing.*character|disappeared|gone|lost.*character/i.test(t)) return "ghost";
  if (/chat|message|convers|thread|history|blank.*chat|empty.*chat/i.test(t)) return "chat";
  if (/location|travel|presence|stuck.*at|wrong.*place|schedule|work.*time/i.test(t)) return "location";
  if (/money|balance|finance|pay|bill|salary|expense/i.test(t)) return "money";
  if (/memory|journal|life.*event|remember|memories/i.test(t)) return "memory";
  if (/image|photo|avatar|picture|generat/i.test(t)) return "image";
  return "other";
}

// ── Repair action map — uses ONLY currently live backend functions ──────────
const REPAIR_ACTIONS = {
  duplicates: [
    {
      label: "Scan for duplicates",
      description: "Re-runs a fresh duplicate scan scoped to your owner_email",
      fn: null, // handled inline via entity query
      inlineAction: "scanDupes",
      safe: true,
    },
  ],
  ghost: [
    {
      label: "Run character diagnostic",
      description: "Checks for orphaned, mistyped, or unowned character records",
      fn: "comprehensiveCharacterDiagnostic",
      safe: true,
    },
  ],
  chat: [
    {
      label: "Diagnose conversation threads",
      description: "Checks conversation ownership and message linkage",
      fn: "troubleshootThread",
      safe: true,
    },
  ],
  location: [
    {
      label: "Diagnose location issues",
      description: "Checks character location sync, generic location labels, and presence state",
      fn: "troubleshootLocations",
      safe: true,
    },
  ],
  money: [
    {
      label: "Check financial records",
      description: "Audits character financial records for this account",
      fn: "deepFinancialDiagnostic",
      safe: true,
    },
  ],
  memory: [
    {
      label: "Check memory linkage",
      description: "Validates memories are linked to the correct characters",
      fn: "diagnosCharacterMemories",
      safe: true,
    },
  ],
  other: [
    {
      label: "Full account diagnostic",
      description: "Runs a broad read-only check across characters, conversations, and settings",
      fn: null,
      inlineAction: "fullDiagnostic",
      safe: true,
    },
  ],
};

// ── Status badge ───────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    received:   { color: "bg-sky-500/20 text-sky-400 border-sky-500/30",         label: "Received"   },
    diagnosing: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30",   label: "Diagnosing" },
    needs_repair:{ color: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "Needs Repair"},
    fixed:      { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Fixed"   },
    blocked:    { color: "bg-destructive/20 text-destructive border-destructive/30", label: "Blocked"  },
    ok:         { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "OK"       },
  };
  const s = map[status] || map.received;
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${s.color}`}>
      {s.label}
    </span>
  );
}

// ── Diagnostic result panel ────────────────────────────────────────────────
function DiagnosticPanel({ diag, onRequestRepair, ownerEmail, onScanDupes }) {
  if (!diag) return null;
  const chars = diag.checks?.characters;
  const convs = diag.checks?.conversations;
  const settings = diag.checks?.settings;

  const hasIssues = (
    (chars?.dupeGroups?.length > 0) ||
    (chars?.missingOwnerEmail > 0) ||
    (chars?.missingType > 0) ||
    settings?.note
  );

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2.5 text-xs">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Account Diagnostic — {ownerEmail}</p>

      {/* Characters */}
      {chars && (
        <div className={`rounded-lg p-2.5 border ${chars.status === "ok" ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-foreground">Characters</span>
            <StatusBadge status={chars.status === "ok" ? "ok" : "needs_repair"} />
          </div>
          <p className="text-muted-foreground">{chars.live} live ({chars.total} total)</p>
          {chars.dupeGroups?.length > 0 && (
            <div className="mt-1.5 space-y-1">
              <p className="text-amber-400 font-medium">⚠ {chars.dupeGroups.length} duplicate group(s) detected:</p>
              {chars.dupeGroups.map((g, i) => (
                <div key={i} className="flex items-center justify-between pl-2">
                  <span className="text-foreground capitalize">"{g.name}" — {g.count} records</span>
                  <button
                    onClick={() => onScanDupes && onScanDupes(g)}
                    className="text-[9px] text-amber-400 underline underline-offset-2 hover:text-amber-300"
                  >
                    Review & Merge
                  </button>
                </div>
              ))}
            </div>
          )}
          {chars.missingOwnerEmail > 0 && (
            <p className="text-destructive mt-1">⚠ {chars.missingOwnerEmail} record(s) missing owner_email — flagged for repair</p>
          )}
          {chars.missingType > 0 && (
            <p className="text-orange-400 mt-1">⚠ {chars.missingType} record(s) missing character_type</p>
          )}
        </div>
      )}

      {/* Conversations */}
      {convs && (
        <div className={`rounded-lg p-2.5 border ${convs.status === "ok" ? "border-emerald-500/20 bg-emerald-500/5" : "border-destructive/20 bg-destructive/5"}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">Conversations</span>
            <StatusBadge status={convs.status === "ok" ? "ok" : "blocked"} />
          </div>
          {convs.error
            ? <p className="text-destructive mt-0.5">{convs.error}</p>
            : <p className="text-muted-foreground mt-0.5">{convs.total} conversation(s) found</p>
          }
        </div>
      )}

      {/* Settings */}
      {settings && (
        <div className={`rounded-lg p-2.5 border ${settings.status === "ok" ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">Account Settings</span>
            <StatusBadge status={settings.status === "ok" ? "ok" : "needs_repair"} />
          </div>
          {settings.note && <p className="text-amber-400 mt-0.5">{settings.note}</p>}
          {!settings.note && <p className="text-muted-foreground mt-0.5">Settings record OK</p>}
        </div>
      )}

      {!hasIssues && (
        <p className="text-emerald-400 text-center py-1">✓ No issues detected in this scan</p>
      )}
    </div>
  );
}

// ── Action result display ──────────────────────────────────────────────────
function ActionResult({ result }) {
  if (!result) return null;
  const isOk = result.ok;
  return (
    <div className={`rounded-xl border p-3 text-xs space-y-1.5 ${isOk ? "border-emerald-500/20 bg-emerald-500/5" : "border-destructive/20 bg-destructive/5"}`}>
      <div className="flex items-center gap-1.5">
        {isOk
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          : <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
        }
        <span className={`font-medium ${isOk ? "text-emerald-300" : "text-destructive"}`}>
          {isOk ? result.label + " — completed" : result.label + " — failed"}
        </span>
      </div>
      {result.summary && <p className="text-muted-foreground pl-5">{result.summary}</p>}
      {result.error && <p className="text-destructive pl-5">{result.error}</p>}
    </div>
  );
}

// ── Chat message bubble ────────────────────────────────────────────────────
function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <div className="flex items-center gap-2 py-1 px-3">
        <div className="flex-1 h-px bg-border/50" />
        <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{msg.content}</span>
        <div className="flex-1 h-px bg-border/50" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2.5 px-3 py-1.5 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-sky-500/20 flex items-center justify-center flex-shrink-0 mt-1 ring-1 ring-sky-500/30">
          <Brain className="w-3.5 h-3.5 text-sky-400" />
        </div>
      )}
      <div className={`max-w-[90%] space-y-2 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-secondary text-foreground rounded-tl-sm"
        }`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <ReactMarkdown
              className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:my-1 [&>ul]:my-1 [&>li]:my-0.5"
              components={{
                code: ({ inline, children }) =>
                  inline
                    ? <code className="bg-black/20 px-1 py-0.5 rounded text-[11px] font-mono">{children}</code>
                    : <pre className="bg-black/30 rounded-lg p-2 text-[11px] font-mono my-1"><code>{children}</code></pre>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>

        {/* Inline diagnostic panel */}
        {msg.diagnostic && (
          <div className="w-full">
            <DiagnosticPanel
              diag={msg.diagnostic}
              ownerEmail={msg.ownerEmail}
              onScanDupes={msg.onScanDupes}
            />
          </div>
        )}

        {/* Action result */}
        {msg.actionResult && <ActionResult result={msg.actionResult} />}

        {/* Repair action buttons */}
        {msg.repairActions?.length > 0 && (
          <div className="w-full space-y-1.5">
            {msg.repairActions.map((action, i) => (
              <button
                key={i}
                onClick={() => action.onRun && action.onRun()}
                disabled={action.disabled}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-xl border border-sky-500/30 bg-sky-500/5 hover:bg-sky-500/10 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wrench className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{action.label}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{action.description}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        )}

        <span className="text-[9px] text-muted-foreground/40">{msg.ts}</span>
      </div>

      {isUser && (
        <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      )}
    </motion.div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function SupportAssistant({ user }) {
  const ownerEmail = user?.email;

  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "ai",
      content: `Hi! I'm your **Account Help & Repair** assistant.\n\nDescribe what's wrong, or pick a category below. All diagnostics run only against your account.`,
      ts: ts(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showQuickPicks, setShowQuickPicks] = useState(true);
  const bottomRef = useRef(null);
  const msgIdRef = useRef(0);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [messages]);

  const nextId = () => `msg_${++msgIdRef.current}_${Date.now()}`;

  const addMessage = (msg) => {
    setMessages(prev => [...prev, { id: nextId(), ...msg }]);
  };

  // ── Run a named backend function (read-only diagnostic) ─────────────────
  const runRepairAction = async (action, msgLabel) => {
    if (!ownerEmail) return;

    addMessage({ role: "system", content: `⚙️ Running: ${msgLabel}…`, ts: ts() });

    try {
      const res = await base44.functions.invoke(action.fn, { owner_email: ownerEmail });
      const data = res?.data;
      const summary = data?.summary || data?.message || JSON.stringify(data)?.slice(0, 300) || "Completed.";
      addMessage({
        role: "ai",
        content: `**${msgLabel}** finished.`,
        actionResult: { ok: true, label: msgLabel, summary },
        ts: ts(),
      });
    } catch (err) {
      addMessage({
        role: "ai",
        content: `**${msgLabel}** encountered an issue.`,
        actionResult: { ok: false, label: msgLabel, error: err.message },
        ts: ts(),
      });
    }
  };

  // ── Full inline diagnostic scan ──────────────────────────────────────────
  const runFullDiagnostic = async () => {
    if (!ownerEmail) return;
    setIsProcessing(true);
    addMessage({ role: "system", content: "🔍 Running account diagnostic…", ts: ts() });

    try {
      const diag = await runOwnerScopedDiagnostic(ownerEmail);
      const chars = diag.checks?.characters;
      const hasIssues = chars?.dupeGroups?.length > 0 || chars?.missingOwnerEmail > 0 || chars?.missingType > 0;

      const category = hasIssues ? "duplicates" : "other";
      const repairs = (REPAIR_ACTIONS[category] || []).map(a => ({
        ...a,
        onRun: a.fn ? () => runRepairAction(a, a.label) : undefined,
        disabled: !a.fn && !a.inlineAction,
      }));

      addMessage({
        role: "ai",
        content: hasIssues
          ? `I found some issues in your account. Here's what the scan detected:`
          : `Your account looks clean. No critical issues found in this scan.`,
        diagnostic: diag,
        ownerEmail,
        onScanDupes: (group) => {
          // Scroll user to Suggested Duplicates section
          addMessage({
            role: "ai",
            content: `To merge **"${group.name}"** safely, scroll up to **System & Data → Suggested Duplicates** and click "Review & Merge". This lets you compare both records before anything is changed.`,
            ts: ts(),
          });
        },
        repairActions: hasIssues ? repairs : [],
        ts: ts(),
      });
    } catch (err) {
      addMessage({
        role: "ai",
        content: `Diagnostic failed: ${err.message}`,
        ts: ts(),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Handle quick pick category ───────────────────────────────────────────
  const handleQuickPick = async (categoryId) => {
    setShowQuickPicks(false);
    addMessage({ role: "user", content: QUICK_ISSUES.find(q => q.id === categoryId)?.label || categoryId, ts: ts() });
    setIsProcessing(true);

    if (categoryId === "duplicates" || categoryId === "ghost" || categoryId === "other") {
      await runFullDiagnostic();
      setIsProcessing(false);
      return;
    }

    // For other categories, show targeted repair options
    const repairs = (REPAIR_ACTIONS[categoryId] || REPAIR_ACTIONS.other).map(a => ({
      ...a,
      onRun: a.fn ? () => runRepairAction(a, a.label) : () => runFullDiagnostic(),
    }));

    addMessage({
      role: "ai",
      content: `Got it — I'll help you with **${QUICK_ISSUES.find(q => q.id === categoryId)?.label}**. Here are the available diagnostic steps for your account:`,
      repairActions: repairs,
      ts: ts(),
    });
    setIsProcessing(false);
  };

  // ── Handle free-text submission ──────────────────────────────────────────
  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isProcessing || !ownerEmail) return;
    setInput("");
    setShowQuickPicks(false);
    addMessage({ role: "user", content: text, ts: ts() });
    setIsProcessing(true);

    const category = classifyIssue(text);
    addMessage({ role: "system", content: `🔍 Classified as: ${category} — scanning your account…`, ts: ts() });

    try {
      // Always run live scoped diagnostic first
      const diag = await runOwnerScopedDiagnostic(ownerEmail);

      // Build LLM context with diagnostic facts
      const chars = diag.checks?.characters;
      const diagFacts = chars
        ? `Account diagnostic (owner_email: ${ownerEmail}):
- ${chars.live} live characters (${chars.total} total)
- ${chars.dupeGroups?.length || 0} duplicate group(s): ${chars.dupeGroups?.map(g => g.name).join(", ") || "none"}
- ${chars.missingOwnerEmail} records missing owner_email
- ${chars.missingType} records missing character_type
- ${diag.checks?.conversations?.total || "?"} conversations found`
        : "";

      const repairs = (REPAIR_ACTIONS[category] || REPAIR_ACTIONS.other).map(a => ({
        ...a,
        onRun: a.fn ? () => runRepairAction(a, a.label) : () => runFullDiagnostic(),
      }));

      const llmPrompt = `You are an account support assistant for a character simulation app.

STRICT RULES:
- Only discuss this user's account (owner_email: ${ownerEmail})
- Never mention other users
- Never use created_by
- Never suggest the user check browser console or developer tools
- Be concise and clear (2-3 sentences max)
- Do NOT offer to do things yourself — just explain what the diagnostic found and what the repair buttons below will do

${diagFacts}

User issue: "${text}"
Detected category: ${category}

Respond with a brief, plain-language explanation of what was found and what the repair options will do.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: llmPrompt,
        model: "gemini_3_flash",
      });

      addMessage({
        role: "ai",
        content: response || "Here's what I found in your account:",
        diagnostic: diag,
        ownerEmail,
        onScanDupes: (group) => {
          addMessage({
            role: "ai",
            content: `To merge **"${group.name}"** safely, scroll up to **System & Data → Suggested Duplicates** and click "Review & Merge".`,
            ts: ts(),
          });
        },
        repairActions: repairs,
        ts: ts(),
      });
    } catch (err) {
      addMessage({
        role: "ai",
        content: `I ran into an issue while checking your account: ${err.message}. Please try again.`,
        ts: ts(),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!ownerEmail) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-sm text-muted-foreground">Loading account info…</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col" style={{ height: 520 }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-card/80 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
        <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
        <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">Account Help & Repair</span>
        <span className="text-[9px] text-muted-foreground/40 ml-auto truncate max-w-[160px]">{ownerEmail}</span>
        <button
          onClick={() => { setMessages(prev => prev.slice(0, 1)); setShowQuickPicks(true); }}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 ml-1"
          title="Clear conversation"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1">
        <AnimatePresence>
          {messages.map(msg => (
            <ChatMessage key={msg.id} msg={msg} />
          ))}
        </AnimatePresence>

        {/* Quick issue picks — shown only at start */}
        {showQuickPicks && !isProcessing && (
          <div className="px-3 py-2 grid grid-cols-2 gap-1.5">
            {QUICK_ISSUES.map(q => (
              <button
                key={q.id}
                onClick={() => handleQuickPick(q.id)}
                className="flex items-center gap-2 p-2.5 rounded-xl border border-border bg-secondary/40 hover:bg-secondary/70 hover:border-sky-500/30 transition-colors text-left"
              >
                <q.icon className={`w-3.5 h-3.5 flex-shrink-0 ${q.color}`} />
                <span className="text-xs text-foreground leading-tight">{q.label}</span>
              </button>
            ))}
          </div>
        )}

        {isProcessing && (
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="w-5 h-5 rounded-full bg-sky-400/10 flex items-center justify-center">
              <Loader2 className="w-3 h-3 text-sky-400 animate-spin" />
            </div>
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-sky-400/60 typing-dot-1" />
              <div className="w-1.5 h-1.5 rounded-full bg-sky-400/60 typing-dot-2" />
              <div className="w-1.5 h-1.5 rounded-full bg-sky-400/60 typing-dot-3" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what's wrong with your account…"
            rows={2}
            disabled={isProcessing}
            className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-sky-400/50 disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isProcessing}
            className="h-10 w-10 rounded-xl bg-sky-600 flex items-center justify-center flex-shrink-0 hover:bg-sky-500 transition-colors disabled:opacity-40"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground/30 mt-1.5 text-center">
          Scoped to your account only · No data from other accounts is ever shown
        </p>
      </div>
    </div>
  );
}