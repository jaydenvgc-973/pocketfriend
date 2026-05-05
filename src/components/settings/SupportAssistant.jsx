import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, Send, CheckCircle2, Loader2, User, Brain, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import ReactMarkdown from "react-markdown";

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

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
              className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>code]:text-xs [&>pre]:text-xs"
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

// ── Safe user-scoped diagnostics ──────────────────────────────────────────────
async function runUserDiagnostics(ownerEmail, issueText) {
  const results = {};

  // 1. Fetch characters scoped strictly to this user's owner_email
  try {
    const chars = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      '-created_date',
      300
    );
    const live = chars.filter(c => c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged');
    const nameMap = new Map();
    live.forEach(c => {
      const key = (c.name || '').trim().toLowerCase();
      if (!nameMap.has(key)) nameMap.set(key, []);
      nameMap.get(key).push(c);
    });
    const dupes = [];
    nameMap.forEach((records, name) => {
      if (records.length >= 2) dupes.push({ name, count: records.length });
    });
    results.characters = {
      total: chars.length,
      live: live.length,
      duplicateGroups: dupes.length,
      duplicateNames: dupes.map(d => d.name).slice(0, 10),
      missingOwnerEmail: chars.filter(c => !c.owner_email).length,
    };
  } catch (e) {
    results.characters = { error: e.message };
  }

  // 2. Check conversations scoped to owner_email
  try {
    const convs = await base44.entities.Conversation.filter({ owner_email: ownerEmail }, '-created_date', 50);
    results.conversations = { total: convs.length };
  } catch (e) {
    results.conversations = { error: e.message };
  }

  return results;
}

// ── Main SupportAssistant component ──────────────────────────────────────────
export default function SupportAssistant({ user }) {
  const ownerEmail = user?.email;

  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'ai',
      content: `Hi! I'm your Account Help & Repair assistant.\n\nI can help you with:\n- **Duplicate characters** — find and review them\n- **Missing chats or messages** — diagnose what happened\n- **Location or schedule issues** — check what's wrong\n- **Ghost records or broken data** — identify and report\n- **Image or voice problems** — walk through the issue\n\nAll diagnostics run only against your account. Just describe what's wrong.`,
      ts: ts(),
    }
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [messages]);

  const addMessage = (msg) => {
    const id = `msg_${Date.now()}_${Math.random()}`;
    setMessages(prev => [...prev, { id, ...msg }]);
  };

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isProcessing || !ownerEmail) return;
    setInput("");
    addMessage({ role: 'user', content: text, ts: ts() });
    setIsProcessing(true);

    const thinkingId = `thinking_${Date.now()}`;
    setMessages(prev => [...prev, { id: thinkingId, role: 'system', content: '🔍 Checking your account…', ts: ts() }]);

    try {
      // Run user-scoped diagnostics if issue-like
      let diagnosticSummary = '';
      const looksLikeDiagnostic = /duplic|ghost|missing|broken|wrong|stuck|character|chat|message|location|schedule|image|voice|memory|badge|money|balance/i.test(text);

      if (looksLikeDiagnostic) {
        const diag = await runUserDiagnostics(ownerEmail, text);
        const parts = [];
        if (diag.characters && !diag.characters.error) {
          parts.push(`Characters: ${diag.characters.live} live (${diag.characters.total} total), ${diag.characters.duplicateGroups} duplicate group(s)${diag.characters.missingOwnerEmail > 0 ? `, ${diag.characters.missingOwnerEmail} missing owner_email` : ''}`);
          if (diag.characters.duplicateNames?.length > 0) {
            parts.push(`Duplicate names: ${diag.characters.duplicateNames.join(', ')}`);
          }
        }
        if (diag.conversations && !diag.conversations.error) {
          parts.push(`Conversations: ${diag.conversations.total} found`);
        }
        if (parts.length > 0) {
          diagnosticSummary = `\n\nLive account diagnostic (owner_email: ${ownerEmail}):\n${parts.join('\n')}`;
        }
      }

      const recentHistory = messages
        .filter(m => m.role === 'user' || m.role === 'ai')
        .slice(-10)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      const systemContext = `You are a helpful account support assistant for a character-based social simulation app called "Own Your Life."

You are speaking with a user whose account email is: ${ownerEmail}

STRICT RULES:
- You ONLY help with this user's account data. Never reference other users.
- Do NOT use "created_by". Ownership is determined solely by owner_email.
- Do NOT suggest the user go to a browser console, dashboard, or developer tools.
- Do NOT run any write operations without clearly explaining what will change.
- For duplicate characters: recommend using "Suggested Duplicates → Review & Merge" in Settings.
- For data issues you cannot fix: explain what was found and that it has been flagged for review.
- Be friendly, clear, and non-technical in your responses.

App areas you can help with: characters, conversations/chats, memories, locations, schedules, images, voice, achievements/badges, finances/balance.

Recent conversation:
${recentHistory}
${diagnosticSummary}`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `${systemContext}\n\nUser issue: ${text}\n\nRespond helpfully:`,
        model: 'gemini_3_flash',
      });

      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      addMessage({ role: 'ai', content: response || 'I was unable to process that. Please try again.', ts: ts() });

      // If duplicates found, surface them visibly
      if (looksLikeDiagnostic) {
        const diag = await runUserDiagnostics(ownerEmail, text).catch(() => null);
        if (diag?.characters?.duplicateGroups > 0) {
          addMessage({
            role: 'system',
            content: `⚠ ${diag.characters.duplicateGroups} duplicate group(s) detected — use "Suggested Duplicates" above to review`,
            ts: ts(),
          });
        }
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
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col" style={{ height: 480 }}>
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1">
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
            placeholder="Describe an issue with your account…"
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
          Scoped to your account only · Enter to send
        </p>
      </div>
    </div>
  );
}