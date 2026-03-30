import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Send, CheckCircle2, XCircle, Loader2, User, Bot, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";

// ── Message types in the chat thread ─────────────────────────────────────────
// role: "user" | "ai" | "system"
// phase: null | "interpreting" | "clarifying" | "awaiting_approval" | "executing" | "result" | "error"

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

const TYPE_COLORS = {
  diagnostic: "bg-blue-400/10 border-blue-400/30 text-blue-300",
  repair:     "bg-orange-400/10 border-orange-400/30 text-orange-300",
  build:      "bg-emerald-400/10 border-emerald-400/30 text-emerald-300",
  combined:   "bg-purple-400/10 border-purple-400/30 text-purple-300",
};

// ── Parse what the AI said and produce actionable backend calls ───────────────
async function executeApprovedPlan(plan, subTasks, systemsAffected, originalRequest, addMessage) {
  const steps = [];
  const req = originalRequest.toLowerCase();

  // Determine what real backend actions to run based on interpretation
  const actions = [];

  // Always start with a broad inspect
  actions.push({ action: 'inspect', payload: {} });

  // Character-specific mention?
  const charMatch = originalRequest.match(/\b(ethan|nathan|lila|[A-Z][a-z]+)'s?\b/gi);
  const mentionedCharName = charMatch?.[0]?.replace(/'s?$/i, '').trim();

  if (mentionedCharName) {
    actions.push({ action: 'inspect_character', payload: { character_name: mentionedCharName } });
  }

  // Memory-related?
  if (/memory|memories|remember|recall|long.?term/i.test(req)) {
    if (mentionedCharName) {
      actions.push({ action: 'list_memories', payload: { character_name: mentionedCharName } });
      actions.push({ action: 'repair_memory', payload: { character_name: mentionedCharName } });
    }
  }

  // Memory extraction from history?
  if (/restore|extract|rebuild|reconnect|missing memory|no memory|lost memory/i.test(req)) {
    if (mentionedCharName) {
      actions.push({ action: 'extract_memories', payload: { character_name: mentionedCharName } });
    }
  }

  // Thread / cross-contamination?
  if (/thread|blank|sharing|cross|contamin|chat.*blank|blank.*chat|misrouting/i.test(req)) {
    if (mentionedCharName) {
      actions.push({ action: 'repair_thread', payload: { character_name: mentionedCharName } });
    }
  }

  // Notification / unread badge?
  if (/notif|badge|unread|stuck badge/i.test(req)) {
    actions.push({ action: 'repair_unread', payload: {} });
  }

  // Pending messages stuck?
  if (/pending|stuck message|not deliver/i.test(req)) {
    actions.push({ action: 'repair_pending', payload: {} });
  }

  // Family fix?
  if (/family|spouse|child|parent|member/i.test(req) && mentionedCharName) {
    actions.push({ action: 'inspect_character', payload: { character_name: mentionedCharName } });
  }

  const results = [];
  for (const { action, payload } of actions) {
    try {
      addMessage({
        role: 'system',
        content: `⚙️ Running: ${action}${payload.character_name ? ` for ${payload.character_name}` : ''}…`,
        ts: ts(),
      });

      const res = await base44.functions.invoke('adminExecute', { action, payload });
      results.push({ action, data: res.data, ok: true });
      steps.push(`✓ ${action} completed`);
    } catch (err) {
      results.push({ action, error: err.message, ok: false });
      steps.push(`✗ ${action} failed: ${err.message}`);
    }
  }

  return { results, steps };
}

// ── Build human-readable summary from execution results ───────────────────────
function buildResultSummary(results, originalRequest) {
  const lines = [];

  for (const r of results) {
    if (!r.ok) {
      lines.push(`**${r.action}**: ⚠️ ${r.error}`);
      continue;
    }
    const d = r.data;
    if (!d) continue;

    switch (r.action) {
      case 'inspect':
        lines.push(`📊 **App inspection complete** — ${d.results?.characters?.length || 0} characters, ${d.results?.memory_count || 0} memories, ${d.results?.conversation_count || 0} conversations.`);
        if (d.results?.stuck_pending_messages > 0) lines.push(`⚠️ ${d.results.stuck_pending_messages} stuck pending messages found.`);
        if (d.results?.cross_contaminated_messages > 0) lines.push(`⚠️ ${d.results.cross_contaminated_messages} cross-contaminated messages detected.`);
        break;

      case 'inspect_character':
        if (d.character) {
          lines.push(`🔍 **${d.character.name}** — status: ${d.character.status || 'active'}, mood: ${d.character.emotional_state}, memories: ${d.memory_count}, conversations: ${d.conversation_count}.`);
          const issues = Object.entries(d.issues_detected || {}).filter(([,v]) => v).map(([k]) => k.replace(/_/g, ' '));
          if (issues.length > 0) lines.push(`Issues detected: ${issues.join(', ')}.`);
          else lines.push(`No critical issues detected for ${d.character.name}.`);
        }
        break;

      case 'list_memories':
        lines.push(`🧠 **${d.character_name}** has **${d.total} memories** stored.`);
        if (d.memories?.length > 0) {
          lines.push(`Most recent memories:`);
          d.memories.slice(0, 5).forEach(m => lines.push(`  • "${m.title}" — ${m.description?.substring(0, 80)}…`));
        }
        break;

      case 'repair_memory':
        lines.push(`🔧 **Memory repair for ${d.character_name}**: ${d.existing_memories} memories active. ${d.orphaned_relinked > 0 ? `Relinked ${d.orphaned_relinked} orphaned memories.` : 'All memories properly linked.'}`);
        if (d.notes) lines.push(`   ℹ️ ${d.notes}`);
        break;

      case 'extract_memories':
        lines.push(`📥 **Memory extraction for ${d.character_name}**: Scanned ${d.conversations_scanned} conversations, extracted and stored **${d.memories_extracted} new memories**.`);
        break;

      case 'repair_thread':
        lines.push(`🔗 **Thread repair for ${d.character_name}**: Checked ${d.conversations_checked} conversations, fixed ${d.conversations_fixed} mapping errors, archived ${d.cross_contaminated_messages_archived} cross-contaminated messages.`);
        break;

      case 'repair_unread':
        lines.push(`🔔 **Unread repair**: Marked ${d.messages_marked_read} messages as read.`);
        break;

      case 'repair_pending':
        lines.push(`📬 **Pending fix**: Cleared ${d.pending_cleared} stuck pending messages.`);
        break;

      case 'repair_family':
        lines.push(`👨‍👩‍👧 **Family repair for ${d.character_name}**: Applied ${d.changes_made} fix(es) to family member list.`);
        break;

      case 'repair_character_status':
        lines.push(`⚙️ **Status update for ${d.character_name}**: ${Object.entries(d.updates_applied).map(([k,v]) => `${k} → ${v}`).join(', ')}`);
        break;

      default:
        if (d.success) lines.push(`✓ ${r.action} succeeded.`);
    }
  }

  return lines;
}

// ── Chat message component ────────────────────────────────────────────────────
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2.5 px-3 py-1 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-1">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div className={`max-w-[85%] space-y-1 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-secondary text-foreground rounded-tl-sm'
        }`}>
          {msg.content}
        </div>

        {/* Interpretation panel inline */}
        {msg.interpretation && (
          <div className="w-full rounded-xl border border-border bg-card/60 p-3 space-y-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${TYPE_COLORS[msg.interpretation.type] || 'text-muted-foreground bg-secondary border-border'}`}>
                {msg.interpretation.type}
              </span>
            </div>
            {msg.interpretation.sub_tasks?.length > 0 && (
              <div>
                <p className="text-[9px] font-bold text-muted-foreground uppercase mb-1">Sub-tasks:</p>
                {msg.interpretation.sub_tasks.map((t, i) => (
                  <p key={i} className="text-foreground flex gap-1.5"><span className="text-primary">·</span>{t}</p>
                ))}
              </div>
            )}
            {msg.interpretation.systems_affected?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {msg.interpretation.systems_affected.map((s, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">{s}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Result lines */}
        {msg.resultLines?.length > 0 && (
          <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1 text-xs">
            {msg.resultLines.map((line, i) => (
              <p key={i} className="text-foreground leading-relaxed">{line}</p>
            ))}
          </div>
        )}

        {/* Error */}
        {msg.error && (
          <div className="w-full rounded-xl border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {msg.error}
          </div>
        )}

        <span className="text-[9px] text-muted-foreground/50">{msg.ts}</span>
      </div>
      {isUser && (
        <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      )}
    </motion.div>
  );
}

// ── Main AdminConsole component ───────────────────────────────────────────────
export default function AdminConsole() {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'ai',
      content: `Admin console ready. I can inspect the app, diagnose issues, repair character data, fix threads, restore memories, and build new features.\n\nDescribe any issue or request in plain language. I'll understand it, ask clarifying questions if needed, and wait for your explicit approval before making any changes.`,
      ts: ts(),
    }
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(null); // { msgId, interpretation, originalRequest }
  const [pendingClarification, setPendingClarification] = useState(null); // { msgId, question, interpretation, originalRequest }
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const addMessage = (msg) => {
    const id = `msg_${Date.now()}_${Math.random()}`;
    setMessages(prev => [...prev, { id, ...msg }]);
    return id;
  };

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isProcessing) return;
    setInput("");

    // If waiting for clarification answer
    if (pendingClarification) {
      addMessage({ role: 'user', content: text, ts: ts() });
      setPendingClarification(null);
      await reinterpretWithClarification(text, pendingClarification.interpretation, pendingClarification.originalRequest);
      return;
    }

    // Normal new request
    addMessage({ role: 'user', content: text, ts: ts() });
    setIsProcessing(true);

    try {
      const thinkingId = addMessage({ role: 'system', content: '⚙️ Interpreting request…', ts: ts() });

      const interpretation = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an AI assistant in an admin control console for a character-based social simulation app.

Admin request: "${text}"

Interpret this request thoroughly. Identify ALL tasks present (do not drop any). Identify systems involved. Determine if clarification is needed.

App systems: characters, conversations/messages, memory/long-term-memory, achievements, games, user settings, scheduled events, pending messages, life events, notifications/unread badges, images/voice, settings page, home page, character profiles, family members, relationships, thread mapping, archive system, storage.

Return JSON:
{
  "type": "diagnostic" | "repair" | "build" | "combined",
  "understood_as": "Plain English full summary",
  "sub_tasks": ["every distinct task"],
  "systems_affected": ["systems"],
  "needs_clarification": true | false,
  "clarification_question": "question or null",
  "plan": "Step-by-step plan including ALL sub-tasks. Be specific about what will be inspected and changed."
}`,
        response_json_schema: {
          type: "object",
          properties: {
            type: { type: "string" },
            understood_as: { type: "string" },
            sub_tasks: { type: "array", items: { type: "string" } },
            systems_affected: { type: "array", items: { type: "string" } },
            needs_clarification: { type: "boolean" },
            clarification_question: { type: "string" },
            plan: { type: "string" },
          }
        },
        model: "claude_sonnet_4_6"
      });

      // Remove the "thinking" system message by replacing it with real AI response
      setMessages(prev => prev.filter(m => m.id !== thinkingId));

      if (interpretation.needs_clarification && interpretation.clarification_question) {
        const msgId = addMessage({
          role: 'ai',
          content: `I understand this as: ${interpretation.understood_as}\n\nBefore I proceed, I need clarification:\n\n**${interpretation.clarification_question}**`,
          interpretation,
          ts: ts(),
        });
        setPendingClarification({ msgId, question: interpretation.clarification_question, interpretation, originalRequest: text });
        addMessage({
          role: 'system',
          content: '🤔 Waiting for your clarification…',
          ts: ts(),
        });
      } else {
        const aiText = `I understand this as:\n\n**${interpretation.understood_as}**\n\n**Plan:**\n${interpretation.plan}\n\nDo you approve? Type "approve" or "yes" to proceed, or ask me to revise anything.`;
        const msgId = addMessage({ role: 'ai', content: aiText, interpretation, ts: ts() });
        setPendingApproval({ msgId, interpretation, originalRequest: text });
        addMessage({
          role: 'system',
          content: '✋ Waiting for your approval before making any changes…',
          ts: ts(),
        });
      }
    } catch (err) {
      addMessage({ role: 'ai', content: `Error interpreting request: ${err.message}`, error: err.message, ts: ts() });
    } finally {
      setIsProcessing(false);
    }
  };

  const reinterpretWithClarification = async (clarificationAnswer, originalInterpretation, originalRequest) => {
    setIsProcessing(true);
    try {
      const sysId = addMessage({ role: 'system', content: '⚙️ Re-interpreting with your answer…', ts: ts() });

      const updated = await base44.integrations.Core.InvokeLLM({
        prompt: `Admin original request: "${originalRequest}"
Clarification question asked: "${originalInterpretation.clarification_question}"
Admin's answer: "${clarificationAnswer}"

Finalize the plan incorporating the clarification. Return JSON:
{
  "type": "diagnostic" | "repair" | "build" | "combined",
  "understood_as": "Updated summary",
  "sub_tasks": ["all tasks"],
  "systems_affected": ["systems"],
  "needs_clarification": false,
  "clarification_question": null,
  "plan": "Final complete plan"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            type: { type: "string" },
            understood_as: { type: "string" },
            sub_tasks: { type: "array", items: { type: "string" } },
            systems_affected: { type: "array", items: { type: "string" } },
            needs_clarification: { type: "boolean" },
            clarification_question: { type: "string" },
            plan: { type: "string" },
          }
        }
      });

      setMessages(prev => prev.filter(m => m.id !== sysId));

      const aiText = `Updated plan:\n\n**${updated.understood_as}**\n\n${updated.plan}\n\nDo you approve? Type "approve" or "yes" to proceed.`;
      addMessage({ role: 'ai', content: aiText, interpretation: updated, ts: ts() });
      setPendingApproval({ interpretation: updated, originalRequest });
      addMessage({ role: 'system', content: '✋ Waiting for approval…', ts: ts() });
    } catch (err) {
      addMessage({ role: 'ai', content: `Re-interpretation error: ${err.message}`, error: err.message, ts: ts() });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproval = async (userText) => {
    const approval = pendingApproval;
    setPendingApproval(null);

    addMessage({ role: 'user', content: userText, ts: ts() });
    setIsProcessing(true);

    addMessage({ role: 'system', content: '🚀 Approval received — executing plan…', ts: ts() });

    try {
      const execResults = await executeApprovedPlan(
        approval.interpretation.plan,
        approval.interpretation.sub_tasks,
        approval.interpretation.systems_affected,
        approval.originalRequest,
        (msg) => addMessage(msg)
      );

      // Build AI summary from real execution results
      const summaryPrompt = `You are reporting back to an admin after completing work on their app.

Admin's original request: "${approval.originalRequest}"

Execution results (JSON):
${JSON.stringify(execResults.results.map(r => ({ action: r.action, success: r.ok, data: r.data, error: r.error })), null, 2)}

Write a clear, specific, honest report in plain English (2-5 paragraphs). Do NOT say "done" or "complete" generically.
Be specific about:
- what was inspected
- what issues were found (if any)  
- what was repaired
- what the current state is
- anything that still needs attention

Keep it factual and specific.`;

      const summaryRes = await base44.integrations.Core.InvokeLLM({ prompt: summaryPrompt });

      const resultLines = buildResultSummary(execResults.results, approval.originalRequest);

      addMessage({
        role: 'ai',
        content: summaryRes || 'Execution completed.',
        resultLines,
        ts: ts(),
      });

      // Save history
      const historyKey = 'admin_console_history';
      try {
        const existing = JSON.parse(localStorage.getItem(historyKey) || '[]');
        existing.unshift({
          request: approval.originalRequest,
          timestamp: new Date().toISOString(),
          type: approval.interpretation.type,
          understood_as: approval.interpretation.understood_as,
          steps: execResults.steps,
        });
        localStorage.setItem(historyKey, JSON.stringify(existing.slice(0, 20)));
      } catch {}

    } catch (err) {
      addMessage({ role: 'ai', content: `Execution error: ${err.message}`, error: err.message, ts: ts() });
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

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;

    // Check if this is an approval response
    if (pendingApproval && /^(approve|yes|confirm|proceed|go ahead|do it|execute|run it)/i.test(text)) {
      setInput("");
      handleApproval(text);
      return;
    }

    // Check if this is a cancel/revise
    if (pendingApproval && /^(cancel|no|stop|revise|change|wait|hold)/i.test(text)) {
      setInput("");
      addMessage({ role: 'user', content: text, ts: ts() });
      setPendingApproval(null);
      addMessage({ role: 'ai', content: `Cancelled. You can describe your request again or revise it.`, ts: ts() });
      return;
    }

    handleSend();
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col" style={{ height: 520 }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border bg-card/80 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <Terminal className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-bold text-primary uppercase tracking-wider">Admin Console</span>
        <span className="text-[9px] text-muted-foreground/60 ml-auto">murqart@gmail.com</span>
        <button
          onClick={() => setMessages(prev => prev.slice(0, 1))}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Clear conversation"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-3 space-y-2">
        <AnimatePresence>
          {messages.map(msg => (
            <ChatMessage key={msg.id} msg={msg} />
          ))}
        </AnimatePresence>
        {isProcessing && (
          <div className="flex items-center gap-2 px-4 py-1">
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
            <span className="text-xs text-muted-foreground">Processing…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border px-3 py-2.5">
        {pendingApproval && (
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => { setInput("approve"); setTimeout(handleSubmit, 50); }}
              disabled={isProcessing}
              className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approve & Execute
            </button>
            <button
              onClick={() => {
                setPendingApproval(null);
                addMessage({ role: 'ai', content: 'Cancelled. What would you like to change?', ts: ts() });
              }}
              className="px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground text-xs hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              pendingApproval
                ? "Type 'approve' to proceed, or describe any changes…"
                : pendingClarification
                ? "Type your answer to the clarification question…"
                : "Describe an issue, request a repair, or ask to build something…"
            }
            rows={2}
            disabled={isProcessing}
            className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 font-mono text-xs"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isProcessing}
            className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            <Send className="w-4 h-4 text-primary-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}