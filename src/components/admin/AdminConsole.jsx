import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Send, CheckCircle2, Loader2, User, Bot, RefreshCw, Zap, Brain, Search, Wrench } from "lucide-react";
import { base44 } from "@/api/base44Client";
import ReactMarkdown from "react-markdown";

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// ── Determine if a message is an app-action request vs a general question ──────
function isActionRequest(text) {
  return /\b(fix|repair|restore|relink|extract|rebuild|check|inspect|diagnose|clean|clear|reset|delete|remove|list|show me|what.*wrong|broken|issue|problem|memory|thread|character|ethan|memories|stuck|badge|unread|pending|contamina|archive|retrieve|backup|conversation|message)\b/i.test(text);
}

// ── Build the full conversation history for the LLM ────────────────────────────
function buildConversationContext(messages) {
  return messages
    .filter(m => m.role === 'user' || m.role === 'ai')
    .slice(-20) // last 20 exchanges for context
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
}

// ── Execute backend actions based on plan ──────────────────────────────────────
async function executeActions(interpretation, originalRequest, addMessage) {
  const req = originalRequest.toLowerCase();
  const actions = [];

  actions.push({ action: 'inspect', payload: {} });

  // Ethan-specific relink?
  if (/ethan/i.test(req) && /relink|restore|connect|fix|all.*files|files.*back|belong/i.test(req)) {
    actions.push({ action: 'relink_all_ethan_data', payload: {} });
  }

  const charMatch = originalRequest.match(/\b(ethan|nathan|lila|[A-Z][a-z]{2,})'?s?\b/g);
  const mentionedCharName = charMatch?.[0]?.replace(/'?s?$/i, '').trim();

  if (mentionedCharName) {
    actions.push({ action: 'inspect_character', payload: { character_name: mentionedCharName } });
  }

  if (/memory|memories|remember|recall|long.?term/i.test(req)) {
    if (mentionedCharName) {
      actions.push({ action: 'repair_memory', payload: { character_name: mentionedCharName } });
      actions.push({ action: 'list_memories', payload: { character_name: mentionedCharName } });
    }
  }

  if (/restore|extract|rebuild|reconnect|missing memory|no memory|lost memory/i.test(req)) {
    if (mentionedCharName) {
      actions.push({ action: 'extract_memories', payload: { character_name: mentionedCharName } });
    }
  }

  if (/thread|blank|cross|contamin|misrouting/i.test(req)) {
    if (mentionedCharName) {
      actions.push({ action: 'repair_thread', payload: { character_name: mentionedCharName } });
    }
  }

  if (/notif|badge|unread/i.test(req)) {
    actions.push({ action: 'repair_unread', payload: {} });
  }

  if (/pending|stuck message|not deliver/i.test(req)) {
    actions.push({ action: 'repair_pending', payload: {} });
  }

  if (/full restore|restore everything|all.*data|all.*files/i.test(req) && mentionedCharName) {
    actions.push({ action: 'full_character_restore', payload: { character_name: mentionedCharName } });
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
    } catch (err) {
      results.push({ action, error: err.message, ok: false });
    }
  }
  return results;
}

// ── Chat message renderer ──────────────────────────────────────────────────────
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
      className={`flex gap-2.5 px-3 py-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-1 ring-1 ring-primary/30">
          <Brain className="w-3.5 h-3.5 text-primary" />
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
              className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>h1]:text-sm [&>h2]:text-xs [&>h3]:text-xs [&>code]:text-xs [&>pre]:text-xs"
              components={{
                code: ({ inline, children }) =>
                  inline
                    ? <code className="bg-black/20 px-1 py-0.5 rounded text-[11px] font-mono">{children}</code>
                    : <pre className="bg-black/30 rounded-lg p-2 overflow-x-auto text-[11px] font-mono my-2"><code>{children}</code></pre>,
                a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{children}</a>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>

        {/* Action results */}
        {msg.actionResults?.length > 0 && (
          <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1 text-xs">
            {msg.actionResults.map((r, i) => (
              <div key={i} className={`flex items-start gap-1.5 ${r.ok ? 'text-emerald-300' : 'text-destructive'}`}>
                {r.ok ? <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" /> : <span className="text-destructive">✗</span>}
                <span>{r.ok ? `${r.action} ✓` : `${r.action}: ${r.error}`}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tags */}
        {msg.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {msg.tags.map((t, i) => (
              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">{t}</span>
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

// ── Capability pills shown at the top ─────────────────────────────────────────
const CAPS = [
  { icon: Brain, label: "Deep Memory" },
  { icon: Search, label: "Web Search" },
  { icon: Wrench, label: "App Repair" },
  { icon: Zap, label: "Logic & Reason" },
];

// ── Main AdminConsole component ────────────────────────────────────────────────
export default function AdminConsole() {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'ai',
      content: `Hello! I'm your intelligent admin assistant — powered by advanced AI with internet access, deep reasoning, and full control over your app's systems.\n\n**I can:**\n- Answer any question on any topic (technology, science, culture, news, analysis)\n- Diagnose and repair your app's data — characters, memories, threads, notifications\n- Relink all of Ethan's files and memories back to him\n- Research topics and interpret complex information\n- Have a real conversation — ask me anything\n\nWhat would you like to do?`,
      ts: ts(),
    }
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(null);
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

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isProcessing) return;
    setInput("");

    // Approval flow
    if (pendingApproval && /^(approve|yes|confirm|proceed|go ahead|do it|execute|run it|y\b)/i.test(text)) {
      addMessage({ role: 'user', content: text, ts: ts() });
      await runApprovedActions(pendingApproval);
      return;
    }

    if (pendingApproval && /^(cancel|no|stop|don't|wait|hold)/i.test(text)) {
      addMessage({ role: 'user', content: text, ts: ts() });
      setPendingApproval(null);
      addMessage({ role: 'ai', content: `Got it — cancelled. What else can I help with?`, ts: ts() });
      return;
    }

    addMessage({ role: 'user', content: text, ts: ts() });
    setPendingApproval(null);
    setIsProcessing(true);

    const thinkingId = `thinking_${Date.now()}`;
    setMessages(prev => [...prev, { id: thinkingId, role: 'system', content: '🧠 Thinking…', ts: ts() }]);

    try {
      const conversationHistory = buildConversationContext(messages);
      const looksLikeAction = isActionRequest(text);

      // Single LLM call — Claude Sonnet with internet for everything
      const systemContext = `You are an intelligent admin AI assistant for a character-based social simulation app called "Own Your Life."

You have two modes:
1. **Conversational AI**: For general questions, analysis, research, or discussion. Answer thoroughly with deep reasoning. You have internet access — use it for current events, research, complex topics.
2. **App Admin Mode**: When the user wants to inspect, repair, or manage app data (characters, memories, threads, etc.), propose a plan and ask for approval before running.

App systems: characters, conversations/messages, memories/long-term-memory, life events, achievements, pending messages, notifications/unread badges, scheduled events, images, voice, archive system.
Key character: **Ethan** — the user frequently needs his files (memories, messages, life events) relinked back to him.

Available backend actions: inspect, inspect_character, repair_memory, extract_memories, repair_thread, repair_unread, repair_pending, list_memories, repair_character_status, repair_family, relink_all_ethan_data (Ethan-specific full data relink), full_character_restore (any character).

Recent conversation:
${conversationHistory}

RULES:
- For general questions/discussion: answer directly and thoroughly. No approval needed.
- For app actions that change data: explain the plan and ask for approval. Include "ACTION_REQUIRED: true" in your response.
- Be conversational, intelligent, curious. Show reasoning. Don't be robotic.
- Use markdown formatting for clarity.
- If asked about complex topics, research and interpret them thoroughly.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `${systemContext}\n\nUser: ${text}\n\nRespond now:`,
        add_context_from_internet: true,
        model: 'gemini_3_pro',
      });

      setMessages(prev => prev.filter(m => m.id !== thinkingId));

      const requiresAction = looksLikeAction && /ACTION_REQUIRED:\s*true/i.test(response);
      const cleanResponse = response.replace(/ACTION_REQUIRED:\s*true/gi, '').trim();

      const msgId = addMessage({
        role: 'ai',
        content: cleanResponse,
        ts: ts(),
        tags: requiresAction ? ['app-action'] : [],
      });

      if (requiresAction) {
        setPendingApproval({ originalRequest: text, interpretation: { plan: cleanResponse } });
        addMessage({ role: 'system', content: '✋ Type "approve" to execute, or ask me to change the plan…', ts: ts() });
      }
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      addMessage({ role: 'ai', content: `I ran into an error: ${err.message}. Please try again.`, ts: ts() });
    } finally {
      setIsProcessing(false);
    }
  };

  const runApprovedActions = async (approval) => {
    setPendingApproval(null);
    setIsProcessing(true);
    addMessage({ role: 'system', content: '🚀 Executing…', ts: ts() });

    try {
      const results = await executeActions(
        approval.interpretation,
        approval.originalRequest,
        (msg) => addMessage(msg)
      );

      // Ask Claude to summarize the results intelligently
      const summaryPrompt = `You are reporting back to the app admin after completing backend work.

Original request: "${approval.originalRequest}"

Execution results:
${JSON.stringify(results.map(r => ({ action: r.action, success: r.ok, data: r.data, error: r.error })), null, 2)}

Write a clear, specific, honest report (2-4 paragraphs). Be specific about what was inspected, what issues were found, what was fixed, and current state. If Ethan's data was relinked, report exactly how many memories/messages/life events were relinked to him. Use markdown.`;

      const summary = await base44.integrations.Core.InvokeLLM({
        prompt: summaryPrompt,
        model: 'gemini_3_pro',
      });

      addMessage({
        role: 'ai',
        content: summary || 'Execution completed.',
        actionResults: results,
        ts: ts(),
      });
    } catch (err) {
      addMessage({ role: 'ai', content: `Execution error: ${err.message}`, ts: ts() });
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

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col" style={{ height: 580 }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-card/80 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <Terminal className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-bold text-primary uppercase tracking-wider">Admin AI</span>
        <div className="flex items-center gap-1.5 ml-2">
          {CAPS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
              <Icon className="w-2.5 h-2.5 text-primary" />
              <span className="text-[9px] text-primary font-medium">{label}</span>
            </div>
          ))}
        </div>
        <span className="text-[9px] text-muted-foreground/50 ml-auto">Gemini Pro + Web</span>
        <button
          onClick={() => setMessages(prev => prev.slice(0, 1))}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
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
        {isProcessing && (
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-3 h-3 text-primary animate-spin" />
            </div>
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-primary/60 typing-dot-1" />
              <div className="w-1.5 h-1.5 rounded-full bg-primary/60 typing-dot-2" />
              <div className="w-1.5 h-1.5 rounded-full bg-primary/60 typing-dot-3" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border px-3 py-3">
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
              onClick={() => { setPendingApproval(null); addMessage({ role: 'ai', content: 'Cancelled. What would you like to change?', ts: ts() }); }}
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
                ? "Type 'approve' to execute, or describe changes…"
                : "Ask anything, request a repair, or start a conversation…"
            }
            rows={2}
            disabled={isProcessing}
            className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isProcessing}
            className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            <Send className="w-4 h-4 text-primary-foreground" />
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground/30 mt-1.5 text-center">
          Powered by Gemini Pro with real-time web access · Enter to send
        </p>
      </div>
    </div>
  );
}