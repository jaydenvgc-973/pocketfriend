import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HelpCircle, Send, Loader2, User, Brain, RefreshCw,
  CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp,
  FileText, Wrench
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import ReactMarkdown from "react-markdown";

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// ── Diagnostic check row ──────────────────────────────────────────────────────
function CheckRow({ check }) {
  const icon = check.status === 'passed'
    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
    : check.status === 'warning'
      ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
      : <XCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />;

  return (
    <div className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
      check.status === 'passed' ? 'bg-emerald-500/5' :
      check.status === 'warning' ? 'bg-amber-500/10' :
      'bg-destructive/10'
    }`}>
      {icon}
      <div>
        <p className="font-medium text-foreground">{check.check}</p>
        <p className="text-muted-foreground mt-0.5">{check.detail}</p>
      </div>
    </div>
  );
}

// ── Collapsible section ───────────────────────────────────────────────────────
function DiagSection({ title, checks = [], issueCount }) {
  const [open, setOpen] = useState(issueCount > 0);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-secondary/50 hover:bg-secondary text-xs font-semibold text-foreground transition-colors"
      >
        <span>{title}</span>
        <div className="flex items-center gap-2">
          {issueCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold">{issueCount} issue{issueCount !== 1 ? 's' : ''}</span>
          )}
          {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-2">
              {checks.map((c, i) => <CheckRow key={i} check={c} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Full diagnostic panel ─────────────────────────────────────────────────────
function DiagnosticPanel({ diagData, onRepair, isRepairing }) {
  if (!diagData) return null;
  const { summary, findings, errors } = diagData;

  const allIssues = Object.values(findings || {}).flatMap(f => (f.checks || []).filter(c => c.status !== 'passed'));
  const hasIssues = allIssues.length > 0;

  return (
    <div className="space-y-3">
      <div className={`p-3 rounded-xl border text-xs ${hasIssues ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
        <p className="font-semibold text-foreground">{summary}</p>
        <p className="text-muted-foreground mt-0.5">Account: {diagData.owner_email}</p>
      </div>

      {findings?.characters && (
        <DiagSection
          title={`Characters (${findings.characters.live} live / ${findings.characters.total} total)`}
          checks={findings.characters.checks || []}
          issueCount={(findings.characters.checks || []).filter(c => c.status !== 'passed').length}
        />
      )}
      {findings?.conversations && (
        <DiagSection
          title={`Conversations (${findings.conversations.total})`}
          checks={findings.conversations.checks || []}
          issueCount={(findings.conversations.checks || []).filter(c => c.status !== 'passed').length}
        />
      )}
      {findings?.memories && (
        <DiagSection
          title={`Memories (${findings.memories.total})`}
          checks={findings.memories.checks || []}
          issueCount={(findings.memories.checks || []).filter(c => c.status !== 'passed').length}
        />
      )}
      {findings?.locations && (
        <DiagSection
          title={`Locations (${findings.locations.total})`}
          checks={findings.locations.checks || []}
          issueCount={(findings.locations.checks || []).filter(c => c.status !== 'passed').length}
        />
      )}
      {findings?.financial && (
        <DiagSection
          title={`Financial (${findings.financial.activeCharacters} active characters)`}
          checks={findings.financial.checks || []}
          issueCount={(findings.financial.checks || []).filter(c => c.status !== 'passed').length}
        />
      )}

      {errors?.length > 0 && (
        <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5 text-xs text-destructive space-y-1">
          <p className="font-semibold">Diagnostic Errors (these checks could not run):</p>
          {errors.map((e, i) => <p key={i}>{e.area}: {e.error}</p>)}
        </div>
      )}

      {/* Repair actions — only shown when issues exist */}
      {hasIssues && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available Repairs</p>
          {findings?.characters?.duplicateGroupCount > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs">
              <p className="font-medium text-foreground">Duplicate Characters</p>
              <p className="text-muted-foreground mt-0.5">Use <strong>Suggested Duplicates → Review &amp; Merge</strong> in Settings to safely merge with full verification. This cannot be done automatically.</p>
            </div>
          )}
          {(findings?.characters?.staleResolved?.length > 0 || findings?.locations?.noScope > 0) && (
            <button
              onClick={() => onRepair('fix_character_locations')}
              disabled={isRepairing}
              className="w-full flex items-center gap-2 p-3 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors text-xs text-left disabled:opacity-50"
            >
              <Wrench className="w-4 h-4 text-primary flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground">Sync character location presence</p>
                <p className="text-muted-foreground">Re-runs location enforcement for all your active characters</p>
              </div>
            </button>
          )}
          {findings?.characters?.missingType?.length > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs">
              <p className="font-medium text-foreground">Characters missing type classification</p>
              <p className="text-muted-foreground mt-0.5">These records need manual review. Use <strong>Edit Character Type</strong> in Settings to classify them correctly.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Chat message bubble ───────────────────────────────────────────────────────
function ChatMessage({ msg }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  if (isSystem) {
    return (
      <div className="flex items-center gap-2 py-1 px-3">
        <div className="flex-1 h-px bg-border/50" />
        <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{msg.content}</span>
        <div className="flex-1 h-px bg-border/50" />
      </div>
    );
  }

  if (msg.role === 'diagnostic') {
    return (
      <div className="px-3 py-2">
        <DiagnosticPanel
          diagData={msg.diagData}
          onRepair={msg.onRepair}
          isRepairing={msg.isRepairing}
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2.5 px-3 py-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-sky-500/20 flex items-center justify-center flex-shrink-0 mt-1 ring-1 ring-sky-500/30">
          <Brain className="w-3.5 h-3.5 text-sky-400" />
        </div>
      )}
      <div className={`max-w-[88%] space-y-1.5 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-secondary text-foreground rounded-tl-sm'
        }`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <ReactMarkdown
              className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:my-1 [&>ul]:my-1 [&>code]:text-xs"
              components={{
                code: ({ inline, children }) =>
                  inline
                    ? <code className="bg-black/20 px-1 py-0.5 rounded text-[11px] font-mono">{children}</code>
                    : <pre className="bg-black/30 rounded-lg p-2 overflow-x-auto text-[11px] font-mono my-2"><code>{children}</code></pre>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>
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

// ── Create IssueReport scoped to this user ────────────────────────────────────
async function createIssueReport(ownerEmail, userId, category, title, description, diagSnapshot, findings) {
  return base44.entities.IssueReport.create({
    owner_email: ownerEmail,
    owner_user_id: userId,
    category,
    title,
    description,
    status: 'received',
    diagnostic_snapshot: diagSnapshot || {},
    findings: findings || [],
  });
}

// ── Determine category from user text ─────────────────────────────────────────
function detectCategory(text) {
  const t = text.toLowerCase();
  if (/duplic|same character|two.*character|merge/i.test(t)) return 'character_duplicates';
  if (/ghost|deleted|leftover|orphan/i.test(t)) return 'ghost_records';
  if (/dangling|broken link|reference/i.test(t)) return 'dangling_references';
  if (/owner|ownership|wrong account/i.test(t)) return 'ownership_mismatch';
  if (/chat|message|conversation|thread/i.test(t)) return 'chat_linkage';
  if (/memory|memories|remember|journal/i.test(t)) return 'missing_memories';
  if (/location|home|place|address|where/i.test(t)) return 'location_presence';
  if (/schedule|travel|presence|at work|sleep/i.test(t)) return 'schedule_travel';
  if (/money|balance|finance|pay|bill/i.test(t)) return 'financial';
  if (/image|photo|voice|audio|picture/i.test(t)) return 'images_voice';
  return 'other';
}

// ── Current live functions the assistant can call (user-scoped only) ───────────
const USER_REPAIR_FUNCTIONS = {
  fix_character_locations: 'enforceLocationPresenceForOwner',
  troubleshoot_locations: 'troubleshootLocations',
  troubleshoot_system: 'troubleshootSystemData',
  troubleshoot_moments: 'troubleshootMoments',
};

// ── Main SupportAssistant ─────────────────────────────────────────────────────
export default function SupportAssistant({ user }) {
  const ownerEmail = user?.email;
  const userId = user?.id;

  const [messages, setMessages] = useState([{
    id: 'welcome',
    role: 'ai',
    content: `Hi! I'm your **Account Help & Repair** assistant.\n\nI can:\n- **Run a full account diagnostic** — characters, chats, memories, locations, finances\n- **Find duplicate characters** — and guide you to the safe merge tool\n- **Check chat/memory linkage** — spot broken references and dangling records\n- **Check location & schedule issues** — presence sync, home assignments\n- **File a support report** — when a repair needs review\n\nAll checks run against your account only (${ownerEmail ? ownerEmail.split('@')[0] + '…' : 'your account'}).\n\nType a problem or say **"run diagnostic"** to start.`,
    ts: ts(),
  }]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [lastDiagData, setLastDiagData] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [messages]);

  const addMessage = (msg) => {
    const id = `msg_${Date.now()}_${Math.random()}`;
    setMessages(prev => [...prev, { id, ...msg }]);
    return id;
  };

  const runFullDiagnostic = async () => {
    addMessage({ role: 'system', content: '🔍 Running full account diagnostic…', ts: ts() });
    const res = await base44.functions.invoke('userAccountDiagnostic', { categories: 'all' });
    const diagData = res?.data;
    if (!diagData) throw new Error('Diagnostic returned no data');
    setLastDiagData(diagData);
    return diagData;
  };

  const handleRepair = async (repair_action) => {
    if (!USER_REPAIR_FUNCTIONS[repair_action]) {
      addMessage({ role: 'ai', content: `⚠️ Repair action \`${repair_action}\` is not a current live path. This repair needs to be updated before it can run.`, ts: ts() });
      return;
    }
    setIsRepairing(true);
    addMessage({ role: 'system', content: `⚙️ Running repair: ${repair_action}…`, ts: ts() });
    try {
      const res = await base44.functions.invoke('userAccountDiagnostic', { categories: 'all', repair_action });
      const result = res?.data?.repair;
      addMessage({
        role: 'ai',
        content: result?.error
          ? `Repair encountered an issue: ${result.error}`
          : `Repair complete. ${result?.result ? JSON.stringify(result.result)?.slice(0, 200) : 'Done.'}`,
        ts: ts(),
      });
    } catch (e) {
      addMessage({ role: 'ai', content: `Repair failed: ${e.message}`, ts: ts() });
    } finally {
      setIsRepairing(false);
    }
  };

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isProcessing || !ownerEmail) return;
    setInput("");
    addMessage({ role: 'user', content: text, ts: ts() });
    setIsProcessing(true);

    const thinkingId = `thinking_${Date.now()}`;
    setMessages(prev => [...prev, { id: thinkingId, role: 'system', content: '🔍 Working on it…', ts: ts() }]);

    try {
      const wantsDiagnostic = /run diagnostic|check.*account|full check|what.*wrong|diagnose|scan|audit/i.test(text);
      const wantsReport = /file.*report|create.*report|submit.*issue|log.*issue|report.*problem/i.test(text);

      let diagData = null;

      // Always run diagnostic if explicitly asked
      if (wantsDiagnostic) {
        diagData = await runFullDiagnostic();
      }

      // Build LLM context
      const recentHistory = messages
        .filter(m => m.role === 'user' || m.role === 'ai')
        .slice(-8)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
        .join('\n\n');

      let diagContext = '';
      if (diagData) {
        const allChecks = Object.values(diagData.findings || {}).flatMap(f => f.checks || []);
        const issues = allChecks.filter(c => c.status !== 'passed');
        diagContext = issues.length > 0
          ? `\n\nLIVE DIAGNOSTIC RESULTS for ${ownerEmail}:\n${issues.map(c => `- [${c.status.toUpperCase()}] ${c.check}: ${c.detail}`).join('\n')}`
          : `\n\nLIVE DIAGNOSTIC: All checks passed — no issues found.`;
      } else if (lastDiagData) {
        diagContext = `\n\n(Previous diagnostic summary: ${lastDiagData.summary})`;
      }

      // CURRENT live repair functions (so LLM never hallucinates old ones)
      const currentFunctions = `
CURRENT LIVE REPAIR FUNCTIONS (only reference these, never invent others):
- userAccountDiagnostic — full account check, all areas
- enforceLocationPresenceForOwner — sync character location presence for this user
- troubleshootLocations — location-specific diagnostics
- troubleshootSystemData — character type/orphan diagnostics
- troubleshootMoments — achievement/badge diagnostics
- mergeCharacters — safe merge (requires explicit user confirmation + UI review first)

UI TOOLS IN SETTINGS:
- "Suggested Duplicates → Review & Merge" — the only safe way to merge duplicate characters
- "Edit Character Type" — classify untyped characters
- "Troubleshoot — Location, Moments & System" — panel with scoped checks`;

      const prompt = `You are the Account Help & Repair assistant for a character-based social simulation app ("Own Your Life").

You are helping user: ${ownerEmail}

STRICT RULES:
- Only reference this user's data. Never mention other accounts.
- Never use "created_by". Ownership = owner_email only.
- Never suggest browser console, developer tools, or direct DB edits.
- Never promise a repair you cannot confirm is a live function.
- If a repair path might be outdated, say: "This repair path may need to be updated — I'll flag it."
- For duplicates: always direct to "Suggested Duplicates → Review & Merge" in Settings.
- When filing a report: confirm to the user that a support ticket has been created.
- Be clear, plain-language, non-technical in your response.

${currentFunctions}

Recent conversation:
${recentHistory}
${diagContext}

User message: ${text}

Respond helpfully. If the user is asking about a specific issue, give a concrete next step. If you found issues in the diagnostic, explain each one in plain language.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        model: 'gemini_3_flash',
      });

      setMessages(prev => prev.filter(m => m.id !== thinkingId));

      // Show AI response
      addMessage({ role: 'ai', content: response || 'I was unable to generate a response. Please try again.', ts: ts() });

      // Show diagnostic panel inline if we ran one
      if (diagData) {
        addMessage({
          role: 'diagnostic',
          diagData,
          onRepair: handleRepair,
          isRepairing,
          ts: ts(),
        });
      }

      // Auto-create IssueReport if issues found and user seems to have a problem
      const looksLikeIssue = !wantsDiagnostic || (diagData && Object.values(diagData.findings || {}).flatMap(f => f.checks || []).some(c => c.status !== 'passed'));
      if (looksLikeIssue && !wantsDiagnostic) {
        // Create issue report silently
        const category = detectCategory(text);
        const snapshot = diagData?.findings || {};
        const findings = diagData ? Object.values(diagData.findings || {}).flatMap(f => f.checks || []) : [];
        createIssueReport(ownerEmail, userId, category, text.slice(0, 120), text, snapshot, findings).catch(() => {});
        addMessage({
          role: 'system',
          content: '📋 Support ticket created — your issue has been logged for review.',
          ts: ts(),
        });
      }

    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      addMessage({ role: 'ai', content: `Something went wrong: ${err.message}. Please try again.`, ts: ts() });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
        <span className="text-[9px] text-muted-foreground/40 ml-auto truncate max-w-[140px]">{ownerEmail}</span>
        <button
          onClick={() => setMessages(prev => prev.slice(0, 1))}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          title="Clear conversation"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 px-3 pt-2 pb-1 flex-shrink-0 overflow-x-auto scrollbar-hide">
        {[
          { label: 'Run Diagnostic', action: 'run diagnostic' },
          { label: 'Check Duplicates', action: 'check for duplicate characters' },
          { label: 'Chat Issues', action: 'check my chat and message history' },
          { label: 'Location Sync', action: 'check location and schedule issues' },
          { label: 'File Report', action: 'file a support report' },
        ].map(({ label, action }) => (
          <button
            key={label}
            onClick={() => { setInput(action); }}
            className="flex-shrink-0 text-[10px] px-2.5 py-1 rounded-full bg-secondary border border-border hover:border-sky-400/40 hover:text-sky-400 text-muted-foreground transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-2 space-y-1">
        <AnimatePresence>
          {messages.map(msg => (
            <ChatMessage key={msg.id} msg={msg} />
          ))}
        </AnimatePresence>
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
            placeholder="Describe an issue or say 'run diagnostic'…"
            rows={2}
            disabled={isProcessing}
            className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:opacity-50"
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
          Scoped to your account only · owner_email isolated · Enter to send
        </p>
      </div>
    </div>
  );
}