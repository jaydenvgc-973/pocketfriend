import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Send, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { base44 } from "@/api/base44Client";

const PHASE = {
  IDLE: "idle",
  INTERPRETING: "interpreting",
  AWAITING_APPROVAL: "awaiting_approval",
  AWAITING_CLARIFICATION: "awaiting_clarification",
  EXECUTING: "executing",
  DONE: "done",
  ERROR: "error",
};

function timestamp() {
  return new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminConsole() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [interpretation, setInterpretation] = useState(null);
  const [clarificationReply, setClarificationReply] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef(null);
  const clarificationRef = useRef(null);

  const submit = async () => {
    const req = input.trim();
    if (!req) return;

    setPhase(PHASE.INTERPRETING);
    setInterpretation(null);
    setResult(null);

    try {
      const interpretPrompt = `You are an AI assistant embedded in an admin control console for a character-based social simulation app.

The admin has submitted the following request:
"${req}"

Your job is to:
1. Interpret what they are asking for (diagnostic, repair, build/feature, or combined)
2. Break it into clear sub-tasks
3. Identify which app systems may be involved (e.g. chat threads, character data, memory, achievements, games, UI, navigation, backend functions)
4. Identify if anything is ambiguous or needs clarification before proceeding
5. Summarize the full plan

App systems include: characters, conversations/messages, memory, achievements, games, user settings, scheduled events, pending messages, life events, groups, images/voice, settings page, home page, character profiles, creation flow.

Respond ONLY in JSON with this exact structure:
{
  "type": "diagnostic" | "repair" | "build" | "combined",
  "understood_as": "Plain English summary of what the admin asked",
  "sub_tasks": ["task 1", "task 2", ...],
  "systems_affected": ["system1", "system2"],
  "needs_clarification": true | false,
  "clarification_question": "Question to ask if needs_clarification is true, else null",
  "plan": "Full plain-English plan of what will be done once approved"
}`;

      const res = await base44.integrations.Core.InvokeLLM({
        prompt: interpretPrompt,
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

      setInterpretation(res);

      if (res.needs_clarification) {
        setPhase(PHASE.AWAITING_CLARIFICATION);
      } else {
        setPhase(PHASE.AWAITING_APPROVAL);
      }
    } catch (err) {
      setPhase(PHASE.ERROR);
      setResult({ error: err.message });
    }
  };

  const submitClarification = async () => {
    const reply = clarificationReply.trim();
    if (!reply || !interpretation) return;

    setPhase(PHASE.INTERPRETING);

    try {
      const reinterpretPrompt = `You are an AI assistant embedded in an admin control console for a character-based social simulation app.

Original admin request: "${input}"
Clarification question asked: "${interpretation.clarification_question}"
Admin's clarification answer: "${reply}"

Now that you have clarification, finalize your full understanding and plan.

Respond ONLY in JSON with this structure:
{
  "type": "diagnostic" | "repair" | "build" | "combined",
  "understood_as": "Updated plain English summary including the clarification",
  "sub_tasks": ["task 1", "task 2", ...],
  "systems_affected": ["system1", "system2"],
  "needs_clarification": false,
  "clarification_question": null,
  "plan": "Complete plan with clarification incorporated"
}`;

      const res = await base44.integrations.Core.InvokeLLM({
        prompt: reinterpretPrompt,
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

      setInterpretation(res);
      setPhase(PHASE.AWAITING_APPROVAL);
    } catch (err) {
      setPhase(PHASE.ERROR);
      setResult({ error: err.message });
    }
  };

  const approve = async () => {
    setPhase(PHASE.EXECUTING);

    try {
      const execPrompt = `You are an AI execution engine embedded in an admin control console for a character-based social simulation app.

The admin has approved the following plan. Execute it fully, completely, and accurately.

ADMIN REQUEST: "${input}"
PLAN: "${interpretation?.plan}"
SUB-TASKS: ${JSON.stringify(interpretation?.sub_tasks)}
SYSTEMS: ${JSON.stringify(interpretation?.systems_affected)}
TYPE: ${interpretation?.type}

Perform the following steps:
1. For DIAGNOSTIC: investigate the issue. Identify root causes, not just symptoms.
2. For REPAIR: describe exactly what logic/data corrections are needed and confirm they are addressed.
3. For BUILD: describe the full component/feature/page spec with UI layout, data structure, logic behavior, and connections needed.
4. For COMBINED: do all of the above for each part.

Respond in JSON:
{
  "execution_summary": "What was done in plain English",
  "tasks_completed": ["task 1 result", "task 2 result", ...],
  "diagnostics_found": ["finding 1", ...] or [],
  "repairs_made": ["repair 1", ...] or [],
  "build_specs": ["spec for each built item", ...] or [],
  "items_needing_manual_action": ["anything that requires the user or developer to take action", ...] or [],
  "success": true | false,
  "notes": "Any important notes or caveats"
}`;

      const res = await base44.integrations.Core.InvokeLLM({
        prompt: execPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            execution_summary: { type: "string" },
            tasks_completed: { type: "array", items: { type: "string" } },
            diagnostics_found: { type: "array", items: { type: "string" } },
            repairs_made: { type: "array", items: { type: "string" } },
            build_specs: { type: "array", items: { type: "string" } },
            items_needing_manual_action: { type: "array", items: { type: "string" } },
            success: { type: "boolean" },
            notes: { type: "string" },
          }
        }
      });

      setResult(res);
      setPhase(PHASE.DONE);

      // Save to history
      setHistory(prev => [{
        request: input,
        timestamp: timestamp(),
        type: interpretation?.type,
        understood_as: interpretation?.understood_as,
        approved: true,
        result: res,
      }, ...prev.slice(0, 19)]);

      setInput("");
      setClarificationReply("");
      setInterpretation(null);
    } catch (err) {
      setPhase(PHASE.ERROR);
      setResult({ error: err.message });
    }
  };

  const cancel = () => {
    setPhase(PHASE.IDLE);
    setInterpretation(null);
    setResult(null);
    setClarificationReply("");
  };

  const typeColors = {
    diagnostic: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    repair: "text-orange-400 bg-orange-400/10 border-orange-400/30",
    build: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    combined: "text-purple-400 bg-purple-400/10 border-purple-400/30",
  };

  return (
    <div className="space-y-5">
      {/* Console Header */}
      <div className="flex items-center gap-2">
        <Terminal className="w-4 h-4 text-primary" />
        <span className="text-xs font-bold text-primary uppercase tracking-wider">Admin Diagnostic & Build Console</span>
        <span className="text-[10px] text-muted-foreground ml-1">(murqart@gmail.com only)</span>
      </div>

      {/* Input Area */}
      <div className="space-y-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`Describe an issue, request a repair, or ask to build a new feature...\n\nExamples:\n• "Ethan's chat thread is blank — fix it"\n• "Nathan and Lila are sharing messages — separate them"\n• "Build a memory archive page accessible from the profile"\n• "Fix the notification badge and add a game stats section"`}
          rows={5}
          disabled={phase !== PHASE.IDLE && phase !== PHASE.DONE && phase !== PHASE.ERROR}
          className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary font-mono disabled:opacity-50"
        />
        {(phase === PHASE.IDLE || phase === PHASE.DONE || phase === PHASE.ERROR) && (
          <button
            onClick={submit}
            disabled={!input.trim()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
            Analyze Request
          </button>
        )}
      </div>

      {/* Interpretation Panel */}
      <AnimatePresence>
        {phase === PHASE.INTERPRETING && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary border border-border"
          >
            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
            <span className="text-sm text-muted-foreground">Interpreting request…</span>
          </motion.div>
        )}

        {(phase === PHASE.AWAITING_APPROVAL || phase === PHASE.AWAITING_CLARIFICATION) && interpretation && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 rounded-2xl border border-border bg-card p-4"
          >
            {/* Type badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${typeColors[interpretation.type] || "text-muted-foreground bg-secondary border-border"}`}>
                {interpretation.type}
              </span>
              <span className="text-xs text-muted-foreground">AI Interpretation</span>
            </div>

            {/* Understanding */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">I understood this as:</p>
              <p className="text-sm text-foreground">{interpretation.understood_as}</p>
            </div>

            {/* Sub-tasks */}
            {interpretation.sub_tasks?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sub-tasks:</p>
                <ul className="space-y-1">
                  {interpretation.sub_tasks.map((t, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                      <span className="text-primary font-bold mt-0.5">{i+1}.</span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Systems */}
            {interpretation.systems_affected?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Systems affected:</p>
                <div className="flex flex-wrap gap-1.5">
                  {interpretation.systems_affected.map((s, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">{s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Plan */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Plan:</p>
              <p className="text-xs text-foreground leading-relaxed">{interpretation.plan}</p>
            </div>

            {/* Clarification needed */}
            {phase === PHASE.AWAITING_CLARIFICATION && interpretation.clarification_question && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-amber-400">🤔 Clarification needed before I can proceed:</p>
                <p className="text-sm text-foreground">{interpretation.clarification_question}</p>
                <textarea
                  ref={clarificationRef}
                  value={clarificationReply}
                  onChange={e => setClarificationReply(e.target.value)}
                  placeholder="Your answer..."
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex gap-2">
                  <button
                    onClick={submitClarification}
                    disabled={!clarificationReply.trim()}
                    className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    Submit Answer
                  </button>
                  <button
                    onClick={cancel}
                    className="px-3 py-2 rounded-lg bg-secondary text-muted-foreground text-xs hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Approval buttons */}
            {phase === PHASE.AWAITING_APPROVAL && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={approve}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Approve & Execute
                </button>
                <button
                  onClick={cancel}
                  className="px-4 py-2.5 rounded-xl bg-secondary border border-border text-muted-foreground text-sm hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </motion.div>
        )}

        {phase === PHASE.EXECUTING && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-3 px-4 py-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30"
          >
            <Loader2 className="w-5 h-5 text-emerald-400 animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-400">Executing approved plan…</p>
              <p className="text-xs text-muted-foreground mt-0.5">This may take a moment. Do not close this page.</p>
            </div>
          </motion.div>
        )}

        {phase === PHASE.DONE && result && !result.error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <p className="text-sm font-bold text-emerald-400">Execution Complete</p>
            </div>

            <p className="text-sm text-foreground">{result.execution_summary}</p>

            {result.tasks_completed?.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tasks completed:</p>
                {result.tasks_completed.map((t, i) => (
                  <p key={i} className="text-xs text-foreground flex gap-1.5"><span className="text-emerald-400">✓</span>{t}</p>
                ))}
              </div>
            )}

            {result.diagnostics_found?.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Diagnostics found:</p>
                {result.diagnostics_found.map((d, i) => (
                  <p key={i} className="text-xs text-amber-400 flex gap-1.5"><span>🔍</span>{d}</p>
                ))}
              </div>
            )}

            {result.repairs_made?.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Repairs made:</p>
                {result.repairs_made.map((r, i) => (
                  <p key={i} className="text-xs text-blue-400 flex gap-1.5"><span>🔧</span>{r}</p>
                ))}
              </div>
            )}

            {result.build_specs?.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Build specifications:</p>
                {result.build_specs.map((b, i) => (
                  <p key={i} className="text-xs text-purple-400 flex gap-1.5"><span>🏗️</span>{b}</p>
                ))}
              </div>
            )}

            {result.items_needing_manual_action?.length > 0 && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 space-y-1">
                <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Manual action required:</p>
                {result.items_needing_manual_action.map((a, i) => (
                  <p key={i} className="text-xs text-foreground flex gap-1.5"><span className="text-amber-400">⚠</span>{a}</p>
                ))}
              </div>
            )}

            {result.notes && (
              <p className="text-xs text-muted-foreground italic">{result.notes}</p>
            )}

            <button
              onClick={() => { setPhase(PHASE.IDLE); setResult(null); }}
              className="w-full py-2 rounded-xl bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              New Request
            </button>
          </motion.div>
        )}

        {phase === PHASE.ERROR && result?.error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-start gap-3 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30"
          >
            <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-destructive">Error</p>
              <p className="text-xs text-muted-foreground">{result.error}</p>
              <button
                onClick={() => { setPhase(PHASE.IDLE); setResult(null); }}
                className="text-xs text-primary hover:underline"
              >
                Try again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History */}
      {history.length > 0 && (
        <div className="border-t border-border pt-4">
          <button
            onClick={() => setShowHistory(h => !h)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            Request History ({history.length})
            {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                  {history.map((h, i) => (
                    <div key={i} className="rounded-lg bg-secondary border border-border p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${typeColors[h.type] || "text-muted-foreground bg-secondary border-border"}`}>
                          {h.type}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{h.timestamp}</span>
                      </div>
                      <p className="text-xs text-foreground line-clamp-1">{h.request}</p>
                      <p className="text-[10px] text-muted-foreground line-clamp-2">{h.understood_as}</p>
                      <p className="text-[10px]">
                        {h.result?.success ? (
                          <span className="text-emerald-400">✓ Completed</span>
                        ) : (
                          <span className="text-destructive">✗ Failed</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}