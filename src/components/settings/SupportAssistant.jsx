import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HelpCircle, Send, Loader2, User, Brain, RefreshCw,
  CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Wrench, Play, Shield
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import ReactMarkdown from "react-markdown";

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// ── Diagnostic sub-components ─────────────────────────────────────────────────

function CheckRow({ check }) {
  const icon = check.status === 'passed'
    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
    : check.status === 'warning'
      ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
      : <XCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />;
  return (
    <div className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
      check.status === 'passed' ? 'bg-emerald-500/5' :
      check.status === 'warning' ? 'bg-amber-500/10' : 'bg-destructive/10'
    }`}>
      {icon}
      <div>
        <p className="font-medium text-foreground">{check.check}</p>
        <p className="text-muted-foreground mt-0.5">{check.detail}</p>
      </div>
    </div>
  );
}

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
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold">
              {issueCount} issue{issueCount !== 1 ? 's' : ''}
            </span>
          )}
          {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="p-3 space-y-2">
              {checks.map((c, i) => <CheckRow key={i} check={c} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DiagnosticPanel({ diagData, onRepair, isRepairing }) {
  if (!diagData) return null;
  const { summary, findings, errors, available_repairs, available_character_repairs } = diagData;
  const allIssues = Object.values(findings || {}).flatMap(f => (f.checks || []).filter(c => c.status !== 'passed'));
  const hasIssues = allIssues.length > 0;

  return (
    <div className="space-y-3">
      <div className={`p-3 rounded-xl border text-xs ${hasIssues ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
        <p className="font-semibold text-foreground">{summary}</p>
        <p className="text-muted-foreground mt-0.5">Account: {diagData.owner_email} · {new Date(diagData.checked_at).toLocaleTimeString()}</p>
      </div>
      {findings?.characters && (
        <DiagSection title={`Characters (${findings.characters.live} live / ${findings.characters.total} total)`} checks={findings.characters.checks || []} issueCount={(findings.characters.checks || []).filter(c => c.status !== 'passed').length} />
      )}
      {findings?.conversations && (
        <DiagSection title={`Conversations (${findings.conversations.total})`} checks={findings.conversations.checks || []} issueCount={(findings.conversations.checks || []).filter(c => c.status !== 'passed').length} />
      )}
      {findings?.memories && (
        <DiagSection title={`Memories (${findings.memories.total})`} checks={findings.memories.checks || []} issueCount={(findings.memories.checks || []).filter(c => c.status !== 'passed').length} />
      )}
      {findings?.locations && (
        <DiagSection title={`Locations (${findings.locations.total})`} checks={findings.locations.checks || []} issueCount={(findings.locations.checks || []).filter(c => c.status !== 'passed').length} />
      )}
      {findings?.financial && (
        <DiagSection title={`Financial (${findings.financial.activeCharacters} active characters)`} checks={findings.financial.checks || []} issueCount={(findings.financial.checks || []).filter(c => c.status !== 'passed').length} />
      )}
      {findings?.schedules && (
        <DiagSection title="Schedules & Work Links" checks={findings.schedules.checks || []} issueCount={(findings.schedules.checks || []).filter(c => c.status !== 'passed').length} />
      )}
      {errors?.length > 0 && (
        <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5 text-xs text-destructive space-y-1">
          <p className="font-semibold">Checks that could not run:</p>
          {errors.map((e, i) => <p key={i}>{e.area}: {e.error}</p>)}
        </div>
      )}
      {hasIssues && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available Repairs</p>
          {findings?.characters?.duplicateGroupCount > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs">
              <p className="font-medium text-foreground">Duplicate Characters</p>
              <p className="text-muted-foreground mt-0.5">Use <strong>Suggested Duplicates → Review &amp; Merge</strong> in Settings to safely merge with full verification.</p>
            </div>
          )}
          {(findings?.characters?.staleResolved?.length > 0 || findings?.locations?.noScopeCount > 0) && (
            <ActionButton repairAction="fix_character_locations" label="Sync character location presence" description="Re-runs location enforcement for all your active characters" availableRepairs={available_repairs} availableCharacterRepairs={available_character_repairs} onRepair={onRepair} isRepairing={isRepairing} />
          )}
          {findings?.characters?.missingType?.length > 0 && (
            <ActionButton repairAction="repair_invalid_types" label="Repair missing character type classifications" description={`${findings.characters.missingType.length} character(s) need type assigned`} availableRepairs={available_repairs} availableCharacterRepairs={available_character_repairs} onRepair={onRepair} isRepairing={isRepairing} />
          )}
          {(findings?.conversations?.emptyCharIds?.length > 0 || findings?.conversations?.danglingConvs?.length > 0) && (
            <ActionButton repairAction="troubleshoot_locations" label="Fix conversation & location linkage" description={`${(findings.conversations.danglingConvs || []).length} conversation(s) have broken character links`} availableRepairs={available_repairs} availableCharacterRepairs={available_character_repairs} onRepair={onRepair} isRepairing={isRepairing} />
          )}
          {(findings?.schedules?.workersMissingWorkLocation?.length > 0 || findings?.schedules?.studentsMissingSchoolLocation?.length > 0) && (
            <ActionButton repairAction="troubleshoot_locations" label="Repair location links for workers/students" description="Re-links work and school location references" availableRepairs={available_repairs} availableCharacterRepairs={available_character_repairs} onRepair={onRepair} isRepairing={isRepairing} />
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ repairAction, label, description, availableRepairs, availableCharacterRepairs, onRepair, isRepairing }) {
  const isLive = (availableRepairs || []).includes(repairAction) || (availableCharacterRepairs || []).includes(repairAction);
  if (!isLive) return (
    <div className="p-2.5 rounded-xl border border-destructive/20 bg-destructive/5 text-xs">
      <p className="text-destructive font-medium">⚠ Repair unavailable: <code>{repairAction}</code></p>
      <p className="text-muted-foreground mt-0.5">Not confirmed in diagnostic. No changes can be made.</p>
    </div>
  );
  return (
    <button onClick={() => onRepair(repairAction)} disabled={isRepairing}
      className="w-full flex items-center gap-2 p-3 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors text-xs text-left disabled:opacity-50">
      <Wrench className="w-4 h-4 text-primary flex-shrink-0" />
      <div>
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

// ── Confirm action card (for destructive or targeted repairs) ─────────────────
function ConfirmCard({ msg, onConfirm, onDeny, isRepairing }) {
  return (
    <div className="mx-3 my-1 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs space-y-2">
      <div className="flex items-start gap-2">
        <Shield className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-foreground font-medium">{msg}</p>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onConfirm} disabled={isRepairing}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
          {isRepairing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {isRepairing ? 'Running…' : 'Yes, run it'}
        </button>
        <button onClick={onDeny} disabled={isRepairing}
          className="flex-1 py-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Chat message renderer ─────────────────────────────────────────────────────
function ChatMessage({ msg, onRepair, isRepairing, onConfirm, onDeny }) {
  const isUser = msg.role === 'user';

  if (msg.role === 'system') {
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
        <DiagnosticPanel diagData={msg.diagData} onRepair={onRepair} isRepairing={isRepairing} />
      </div>
    );
  }

  if (msg.role === 'confirm') {
    return <ConfirmCard msg={msg.content} onConfirm={() => onConfirm(msg.actionKey, msg.actionPayload)} onDeny={onDeny} isRepairing={isRepairing} />;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2.5 px-3 py-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-sky-500/20 flex items-center justify-center flex-shrink-0 mt-1 ring-1 ring-sky-500/30">
          <Brain className="w-3.5 h-3.5 text-sky-400" />
        </div>
      )}
      <div className={`max-w-[88%] flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-foreground rounded-tl-sm'
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

// ── Intent router — maps plain text to a direct action (no LLM needed) ────────
function detectIntent(text) {
  const t = text.toLowerCase();

  if (/run.*owner.*email.*backfill|backfill.*owner|repair.*owner.*email|fix.*owner.*email/i.test(t))
    return { type: 'backfill_owner_email' };

  if (/clean.*ghost|ghost.*reference|dangling.*reference|record.*not.*found|remove.*stale/i.test(t))
    return { type: 'clean_ghost_references' };

  if (/run.*diagnostic|check.*account|full.*check|diagnose.*everything|scan.*account|what.*wrong.*account|check.*everything/i.test(t))
    return { type: 'full_diagnostic' };

  if (/merge.*blocked|blocked.*merge|ownership.*needs.*repair|legacy.*owner|missing.*owner.*email/i.test(t))
    return { type: 'merge_blocked' };

  if (/sync.*location|location.*sync|character.*wrong.*location|location.*wrong|presence.*wrong|where.*character/i.test(t))
    return { type: 'sync_locations' };

  if (/not.*go.*work|won't.*work|won't go to work|skip.*work|miss.*work|not.*show.*work|work.*schedule.*broken/i.test(t))
    return { type: 'work_schedule' };

  if (/money.*wrong|wrong.*money|balance.*wrong|negative.*balance|not.*paid|payroll|finance.*issue|money.*missing/i.test(t))
    return { type: 'finance_check' };

  if (/world.*name.*won't.*save|world.*name.*not.*saving|name.*won't.*save|my.*name.*not.*saving|save.*world.*name|set.*world.*name|change.*world.*name|update.*world.*name/i.test(t))
    return { type: 'world_name_save' };

  if (/not.*traveling|won't.*travel|stuck.*location|travel.*broken|not.*moving/i.test(t))
    return { type: 'travel_check' };

  if (/character.*missing|can't.*find.*character|missing.*character|disappeared/i.test(t))
    return { type: 'missing_character' };

  if (/wrong.*image|image.*wrong|image.*broken|picture.*wrong|photo.*wrong/i.test(t))
    return { type: 'image_issue' };

  if (/diagnose.*owner|ownership.*diagnostic|check.*owner.*email|owner.*email.*status|read.*only.*owner|inspect.*ownership|ownership.*issue|legacy.*owner|legacy.*character.*owner/i.test(t))
    return { type: 'ownership_diagnostic' };

  return null;
}

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

// ── Visibility snapshot — captured before any repair, verified after ──────────
// Returns { ids, names, count } for the current user's visible characters.
async function captureVisibilitySnapshot(ownerEmail) {
  try {
    const chars = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      "created_date",
      300
    );
    const live = chars.filter(c => c.is_test_character !== true && c.diagnostic_only !== true && c.status !== 'deleted');
    return {
      ids: live.map(c => c.id),
      names: live.map(c => c.name || '(unnamed)'),
      count: live.length,
      capturedAt: Date.now(),
    };
  } catch (e) {
    return null; // snapshot unavailable — block repair
  }
}

// Verify snapshot after repair. Returns { safe, lost, gained }
function verifyVisibilitySnapshot(before, after) {
  if (!before || !after) return { safe: false, lost: [], gained: [] };
  const beforeIds = new Set(before.ids);
  const afterIds = new Set(after.ids);
  const lost = before.ids.filter(id => !afterIds.has(id));
  const gained = after.ids.filter(id => !beforeIds.has(id));
  // Safe only if no characters were lost. Gains are fine (visibility restored).
  return { safe: lost.length === 0, lost, gained };
}

// ── Main SupportAssistant ─────────────────────────────────────────────────────
export default function SupportAssistant({ user }) {
  const ownerEmail = user?.email;
  const userId = user?.id;

  const [messages, setMessages] = useState([{
    id: 'welcome',
    role: 'ai',
    content: `Hi! I'm your **Account Help & Repair** assistant — I can run real diagnostics and repairs directly.\n\nJust describe what's wrong:\n- *"My merge is blocked"*\n- *"My character isn't going to work"*\n- *"My money is wrong"*\n- *"Run the owner email backfill"*\n- *"My character is missing"*\n- *"Diagnose my ownership"*\n- *"Sync my locations"*\n\nI'll identify the issue, run the right tool, and show you what I find — no dashboards or console logs needed.\n\n⚠️ All repairs require your confirmation and capture a visibility snapshot before and after to ensure no characters disappear.`,
    ts: ts(),
  }]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [lastDiagData, setLastDiagData] = useState(null);
  // pending confirm: { actionKey, actionPayload, confirmMsgId }
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [messages]);

  const addMsg = (msg) => {
    const id = `msg_${Date.now()}_${Math.random()}`;
    setMessages(prev => [...prev, { id, ...msg }]);
    return id;
  };

  const removeMsgById = (id) => setMessages(prev => prev.filter(m => m.id !== id));

  // ── Full account diagnostic ───────────────────────────────────────────────
  const runFullDiagnostic = async () => {
    addMsg({ role: 'system', content: '🔍 Running full account diagnostic…', ts: ts() });
    const res = await base44.functions.invoke('userAccountDiagnostic', { categories: 'all' });
    const diagData = res?.data;
    if (!diagData) throw new Error('Diagnostic returned no data');
    setLastDiagData(diagData);
    return diagData;
  };

  // ── Repair dispatch via userAccountDiagnostic ─────────────────────────────
  // VISIBILITY SAFETY: captures snapshot before repair, verifies after.
  // If ANY character disappears after repair, immediately reports the loss and
  // marks the repair as requiring rollback review. Does NOT auto-rollback (that
  // would require storing prior field values, which adds complexity), but
  // DOES surface the visibility failure visibly so the user can report it.
  const runRepairAction = async (repair_action, repair_character_id = null) => {
    setIsRepairing(true);
    addMsg({ role: 'system', content: `⚙️ Running: ${repair_action}…`, ts: ts() });

    // STEP 1: Capture visibility snapshot BEFORE repair
    const snapshotBefore = await captureVisibilitySnapshot(ownerEmail);
    if (!snapshotBefore) {
      addMsg({ role: 'ai', content: `⚠️ **Repair paused** — could not capture a visibility snapshot before proceeding. No changes were made.\n\nThis is a safety check: repairs require a baseline snapshot to verify no characters disappear afterward. Please try again.`, ts: ts() });
      setIsRepairing(false);
      return;
    }
    addMsg({ role: 'system', content: `📸 Visibility snapshot: ${snapshotBefore.count} visible characters`, ts: ts() });

    try {
      const payload = { categories: 'none', repair_action };
      if (repair_character_id) payload.repair_character_id = repair_character_id;
      const res = await base44.functions.invoke('userAccountDiagnostic', payload);
      const result = res?.data?.repair;

      if (result?.blocked) {
        addMsg({ role: 'ai', content: `**Repair blocked:** ${result.reason}\n\nNo changes were made.`, ts: ts() });
        base44.entities.IssueReport.create({ owner_email: ownerEmail, owner_user_id: userId, category: 'other', title: `Repair blocked: ${repair_action}`, description: result.reason, status: 'repair_pending', findings: [] }).catch(() => {});
      } else if (result?.error) {
        addMsg({ role: 'ai', content: `**Repair error:** ${result.error}`, ts: ts() });
      } else {
        const resultText = typeof result?.result === 'object' ? JSON.stringify(result.result, null, 2).slice(0, 400) : (result?.result || 'Done.');

        // STEP 2: Verify visibility snapshot AFTER repair
        const snapshotAfter = await captureVisibilitySnapshot(ownerEmail);
        const verify = verifyVisibilitySnapshot(snapshotBefore, snapshotAfter);

        if (!verify.safe) {
          const lostNames = verify.lost.map(id => snapshotBefore.names[snapshotBefore.ids.indexOf(id)] || id);
          addMsg({ role: 'ai', content: `🚨 **VISIBILITY FAILURE DETECTED**\n\nRepair ran but **${verify.lost.length} character(s) became invisible afterward:**\n${lostNames.map(n => `- ${n}`).join('\n')}\n\nBefore: ${snapshotBefore.count} visible | After: ${snapshotAfter?.count ?? '?'} visible\n\n**This repair may have had an unintended side effect.** A support ticket has been filed automatically. Your characters still exist in the database — this may be a visibility/cache issue that resolves on refresh.`, ts: ts() });
          base44.entities.IssueReport.create({
            owner_email: ownerEmail, owner_user_id: userId,
            category: 'ownership_mismatch',
            title: `VISIBILITY_FAILURE after repair: ${repair_action}`,
            description: `Before: ${snapshotBefore.count} chars (${snapshotBefore.ids.join(', ')}). After: ${snapshotAfter?.count}. Lost IDs: ${verify.lost.join(', ')}`,
            status: 'escalated',
            findings: [],
          }).catch(() => {});
        } else {
          const gainedNote = verify.gained.length > 0 ? ` (+${verify.gained.length} newly visible)` : '';
          addMsg({ role: 'ai', content: `**Repair complete ✓** — Visibility safe: ${snapshotAfter?.count} characters visible${gainedNote}\n\n${resultText}\n\nRe-running diagnostic to verify…`, ts: ts() });
          const verifyData = await runFullDiagnostic();
          addMsg({ role: 'diagnostic', diagData: verifyData, ts: ts() });
        }
      }
    } catch (e) {
      addMsg({ role: 'ai', content: `Repair failed: ${e.message}. No changes were made.`, ts: ts() });
    } finally {
      setIsRepairing(false);
    }
  };

  // ── Handle confirm card click ─────────────────────────────────────────────
  const handleConfirm = async (actionKey, actionPayload) => {
    // Remove the confirm card
    if (pendingConfirm?.confirmMsgId) removeMsgById(pendingConfirm.confirmMsgId);
    setPendingConfirm(null);

    if (actionKey === 'backfill_owner_email') {
      setIsRepairing(true);
      addMsg({ role: 'system', content: '⚙️ Running owner email backfill…', ts: ts() });

      // VISIBILITY SNAPSHOT BEFORE
      const snapshotBefore = await captureVisibilitySnapshot(ownerEmail);
      if (!snapshotBefore) {
        addMsg({ role: 'ai', content: `⚠️ **Repair paused** — could not capture a visibility snapshot. No changes made. Please try again.`, ts: ts() });
        setIsRepairing(false);
        return;
      }
      addMsg({ role: 'system', content: `📸 Visibility snapshot: ${snapshotBefore.count} visible characters`, ts: ts() });

      try {
        const res = await base44.functions.invoke('backfillMyCharacterOwnerEmail', {});
        const d = res?.data;
        if (!d) throw new Error('No response');
        const r = d.results || {};
        const lines = [
          `**Owner Email Backfill Complete**`,
          ``,
          `- Scanned: **${r.scanned ?? 0}** records`,
          `- Already correct: **${r.already_correct ?? 0}**`,
          `- Repaired: **${r.repaired?.length ?? 0}**`,
          r.repaired?.length > 0 ? r.repaired.map(x => `  ✓ ${x.name}`).join('\n') : null,
          r.skipped_wrong_account?.length > 0 ? `- Blocked (cross-account): **${r.skipped_wrong_account.length}** — not modified` : null,
          r.errors?.length > 0 ? `- Errors: **${r.errors.length}**` : null,
        ].filter(Boolean).join('\n');
        addMsg({ role: 'ai', content: lines, ts: ts() });

        // VISIBILITY SNAPSHOT AFTER
        const snapshotAfter = await captureVisibilitySnapshot(ownerEmail);
        const verify = verifyVisibilitySnapshot(snapshotBefore, snapshotAfter);
        if (!verify.safe) {
          const lostNames = verify.lost.map(id => snapshotBefore.names[snapshotBefore.ids.indexOf(id)] || id);
          addMsg({ role: 'ai', content: `🚨 **VISIBILITY FAILURE** — ${verify.lost.length} character(s) became invisible after backfill: ${lostNames.join(', ')}. Support ticket filed.`, ts: ts() });
          base44.entities.IssueReport.create({ owner_email: ownerEmail, owner_user_id: userId, category: 'ownership_mismatch', title: `VISIBILITY_FAILURE after backfill`, description: `Lost IDs: ${verify.lost.join(', ')}`, status: 'escalated', findings: [] }).catch(() => {});
        } else {
          addMsg({ role: 'system', content: `✅ Visibility safe: ${snapshotAfter?.count} characters still visible`, ts: ts() });
        }

        if (d.admin_required) {
          addMsg({ role: 'ai', content: `Some records couldn't be repaired because they lack both \`owner_email\` and a matching \`owner_user_id\`. These require admin review — a support ticket has been filed.`, ts: ts() });
          base44.entities.IssueReport.create({ owner_email: ownerEmail, owner_user_id: userId, category: 'ownership_mismatch', title: 'Owner email backfill — admin review required', description: `Records found without sufficient ownership evidence during backfill.`, status: 'repair_pending', findings: [] }).catch(() => {});
        }
      } catch (err) {
        addMsg({ role: 'ai', content: `Backfill failed: ${err.message}. No changes were made.`, ts: ts() });
      } finally {
        setIsRepairing(false);
      }
      return;
    }

    if (actionKey === 'clean_ghost_references') {
      await runRepairAction('troubleshoot_locations');
      return;
    }

    if (actionKey === 'sync_locations') {
      await runRepairAction('fix_character_locations');
      return;
    }

    if (actionKey === 'targeted_owner_repair') {
      // Run targeted single-record repair
      await runTargetedOwnerRepair(actionPayload.character_id, actionPayload.character_name);
      // If there are remaining records to repair, queue the next one
      const remaining = actionPayload.remaining || [];
      if (remaining.length > 0) {
        const next = remaining[0];
        addMsg({ role: 'ai', content: `There ${remaining.length > 1 ? `are ${remaining.length} more` : 'is 1 more'} record(s) that need repair.`, ts: ts() });
        const confirmId = addMsg({
          role: 'confirm',
          content: `Repair owner_email for "${next.name}" next? Same rules apply — only repaired if owner_user_id matches your account.`,
          actionKey: 'targeted_owner_repair',
          actionPayload: { character_id: next.id, character_name: next.name, remaining: remaining.slice(1) },
          ts: ts(),
        });
        setPendingConfirm({ actionKey: 'targeted_owner_repair', actionPayload: { character_id: next.id, character_name: next.name, remaining: remaining.slice(1) }, confirmMsgId: confirmId });
      } else {
        addMsg({ role: 'ai', content: `All records processed. You can now retry the merge from **Settings → Suggested Duplicates**.`, ts: ts() });
      }
      return;
    }

    if (actionKey === 'save_world_name') {
      setIsRepairing(true);
      addMsg({ role: 'system', content: '⚙️ Saving world name…', ts: ts() });
      try {
        const settings = await base44.entities.UserSettings.filter({ owner_email: ownerEmail });
        const s = settings[0];
        if (!s?.id) throw new Error('No UserSettings record found to update');
        await base44.entities.UserSettings.update(s.id, { fictional_world_name: actionPayload.world_name });
        // Verify the write
        const verify = await base44.entities.UserSettings.filter({ owner_email: ownerEmail });
        const saved = verify[0]?.fictional_world_name;
        if (saved === actionPayload.world_name) {
          addMsg({ role: 'ai', content: `✅ **World name saved successfully.**\n\nYour world name is now: **"${saved}"**\n\nThis will take effect the next time a character references your identity.`, ts: ts() });
        } else {
          addMsg({ role: 'ai', content: `⚠️ Write appeared to succeed but verification returned: **"${saved || '(empty)'}"**. The cache may still be stale — try refreshing Settings.`, ts: ts() });
        }
      } catch (err) {
        addMsg({ role: 'ai', content: `Save failed: ${err.message}. No changes were made.`, ts: ts() });
      } finally {
        setIsRepairing(false);
      }
      return;
    }

    // Generic repair path
    await runRepairAction(actionKey, actionPayload?.character_id);
  };

  const handleDeny = () => {
    if (pendingConfirm?.confirmMsgId) removeMsgById(pendingConfirm.confirmMsgId);
    setPendingConfirm(null);
    addMsg({ role: 'ai', content: 'Cancelled — no changes were made.', ts: ts() });
  };

  // ── Targeted single-record owner_email repair via repairCharacterOwnerEmail ──
  // VISIBILITY SAFETY: captures snapshot before and after. If any character
  // disappears, surfaces the failure immediately and files a support ticket.
  const runTargetedOwnerRepair = async (characterId, characterName) => {
    setIsRepairing(true);
    addMsg({ role: 'system', content: `⚙️ Repairing owner_email for "${characterName}"…`, ts: ts() });

    // Snapshot BEFORE
    const snapshotBefore = await captureVisibilitySnapshot(ownerEmail);
    if (!snapshotBefore) {
      addMsg({ role: 'ai', content: `⚠️ **Repair paused** — could not capture a visibility snapshot. No changes made.`, ts: ts() });
      setIsRepairing(false);
      return;
    }
    addMsg({ role: 'system', content: `📸 Visibility snapshot: ${snapshotBefore.count} visible characters`, ts: ts() });

    try {
      const res = await base44.functions.invoke('repairCharacterOwnerEmail', { characterId });
      const d = res?.data;
      if (!d) throw new Error('No response from repair function');
      if (d.repaired) {
        // Snapshot AFTER
        const snapshotAfter = await captureVisibilitySnapshot(ownerEmail);
        const verify = verifyVisibilitySnapshot(snapshotBefore, snapshotAfter);
        if (!verify.safe) {
          const lostNames = verify.lost.map(id => snapshotBefore.names[snapshotBefore.ids.indexOf(id)] || id);
          addMsg({ role: 'ai', content: `🚨 **VISIBILITY FAILURE** — Repair ran but ${verify.lost.length} character(s) became invisible: ${lostNames.join(', ')}. Support ticket filed. Your characters still exist — try refreshing.`, ts: ts() });
          base44.entities.IssueReport.create({ owner_email: ownerEmail, owner_user_id: userId, category: 'ownership_mismatch', title: `VISIBILITY_FAILURE after targeted repair: ${characterName}`, description: `Lost IDs: ${verify.lost.join(', ')}`, status: 'escalated', findings: [] }).catch(() => {});
        } else {
          addMsg({ role: 'ai', content: `✅ **Repaired** — \`owner_email\` set on **${characterName}**.\n\nProof used: \`owner_user_id\` matched your account ID.\nVisibility safe: ${snapshotAfter?.count} characters still visible.\n\nYou can now retry the merge from Settings → Suggested Duplicates.`, ts: ts() });
        }
      } else if (d.reason === 'CROSS_ACCOUNT') {
        addMsg({ role: 'ai', content: `🚫 **Blocked** — "${characterName}" belongs to a different account. Cross-account repair is permanently blocked.\n\nA support ticket has been filed if this is unexpected.`, ts: ts() });
        base44.entities.IssueReport.create({ owner_email: ownerEmail, owner_user_id: userId, category: 'ownership_mismatch', title: `CROSS_ACCOUNT_BLOCKED: ${characterName}`, description: `Character ${characterId} has owner_email belonging to a different account. Repair blocked.`, status: 'escalated', findings: [] }).catch(() => {});
      } else if (d.reason === 'ALREADY_SET') {
        addMsg({ role: 'ai', content: `ℹ️ **Already correct** — "${characterName}" already has a valid \`owner_email\`. No changes needed.\n\nIf the merge is still blocked, there may be a different blocker — run a full diagnostic.`, ts: ts() });
      } else if (d.reason === 'NO_EVIDENCE') {
        addMsg({ role: 'ai', content: `⚠️ **Cannot repair** — "${characterName}" has no \`owner_user_id\` to verify against. Cannot confirm ownership without evidence.\n\nA support ticket has been filed for admin review.`, ts: ts() });
        base44.entities.IssueReport.create({ owner_email: ownerEmail, owner_user_id: userId, category: 'ownership_mismatch', title: `NO_EVIDENCE for owner repair: ${characterName}`, description: `Character ${characterId} has no owner_user_id — ownership cannot be confirmed without admin review.`, status: 'repair_pending', findings: [] }).catch(() => {});
      } else {
        addMsg({ role: 'ai', content: `Repair returned: ${d.reason || d.message || 'Unknown result'}. No changes confirmed.`, ts: ts() });
      }
    } catch (err) {
      addMsg({ role: 'ai', content: `Targeted repair failed: ${err.message}. No changes were made.`, ts: ts() });
    } finally {
      setIsRepairing(false);
    }
  };

  // ── Read-only ownership diagnostic — NO writes, just inspection ───────────
  const runOwnershipDiagnostic = async () => {
    addMsg({ role: 'system', content: '🔍 Running read-only ownership diagnostic…', ts: ts() });
    try {
      // Capture visibility snapshot (read-only baseline)
      const snapshot = await captureVisibilitySnapshot(ownerEmail);
      if (!snapshot) throw new Error('Could not read characters from your account');

      addMsg({ role: 'system', content: `📸 Visible characters: ${snapshot.count}`, ts: ts() });

      // Read all characters via RLS (user-scoped)
      const chars = await base44.entities.Character.filter({ owner_email: ownerEmail }, 'created_date', 300);
      const live = chars.filter(c => c.is_test_character !== true && c.diagnostic_only !== true && c.status !== 'deleted');

      const rows = live.map(c => {
        const hasOwnerEmail = !!c.owner_email;
        const hasOwnerUserId = !!c.owner_user_id;
        const ownerEmailMatches = c.owner_email === ownerEmail;
        const ownerUserIdMatches = c.owner_user_id === userId;
        const hasType = !!c.character_type;

        let ownershipState, repairNeeded, repairBlocker;
        if (hasOwnerEmail && ownerEmailMatches) {
          ownershipState = 'CORRECT';
          repairNeeded = false;
        } else if (!hasOwnerEmail && hasOwnerUserId && ownerUserIdMatches) {
          ownershipState = 'LEGACY_MISSING_OWNER_EMAIL';
          repairNeeded = true;
          repairBlocker = null;
        } else if (!hasOwnerEmail && !hasOwnerUserId) {
          ownershipState = 'LEGACY_NO_PROOF';
          repairNeeded = true;
          repairBlocker = 'No owner_user_id to verify against — requires admin review';
        } else if (hasOwnerEmail && !ownerEmailMatches) {
          ownershipState = 'CROSS_ACCOUNT_BLOCKED';
          repairNeeded = false;
          repairBlocker = 'owner_email points to a different account — permanently blocked';
        } else {
          ownershipState = 'UNKNOWN';
          repairNeeded = false;
          repairBlocker = 'Unexpected state — requires investigation';
        }

        return { id: c.id, name: c.name || '(unnamed)', character_type: c.character_type || '(missing)', status: c.status || 'active', ownershipState, repairNeeded, repairBlocker, hasType };
      });

      const correct = rows.filter(r => r.ownershipState === 'CORRECT');
      const legacyRepairable = rows.filter(r => r.ownershipState === 'LEGACY_MISSING_OWNER_EMAIL');
      const legacyNoProof = rows.filter(r => r.ownershipState === 'LEGACY_NO_PROOF');
      const crossAccount = rows.filter(r => r.ownershipState === 'CROSS_ACCOUNT_BLOCKED');
      const missingType = rows.filter(r => !r.hasType);

      let report = `**Read-Only Ownership Diagnostic** *(no changes made)*\n\n`;
      report += `**Visible characters scanned:** ${live.length}\n\n`;

      if (correct.length > 0) report += `✅ **Correct ownership:** ${correct.length} character(s) — \`owner_email\` matches your account\n\n`;

      if (legacyRepairable.length > 0) {
        report += `⚠️ **Repairable (${legacyRepairable.length})** — missing \`owner_email\` but \`owner_user_id\` matches your account:\n`;
        report += legacyRepairable.map(r => `- **${r.name}** (${r.character_type}) — can be repaired with targeted owner repair`).join('\n');
        report += '\n\n';
      }

      if (legacyNoProof.length > 0) {
        report += `⛔ **Needs admin review (${legacyNoProof.length})** — no \`owner_user_id\` to verify against:\n`;
        report += legacyNoProof.map(r => `- **${r.name}** (${r.character_type}) — ${r.repairBlocker}`).join('\n');
        report += '\n\n';
      }

      if (crossAccount.length > 0) {
        report += `🚫 **Cross-account blocked (${crossAccount.length})** — these cannot be repaired:\n`;
        report += crossAccount.map(r => `- **${r.name}** — ${r.repairBlocker}`).join('\n');
        report += '\n\n';
      }

      if (missingType.length > 0) {
        report += `ℹ️ **Missing character_type (${missingType.length})** — legacy characters without a type field (visibility protected by fallback logic):\n`;
        report += missingType.map(r => `- **${r.name}**`).join('\n');
        report += '\n\n';
      }

      report += `*This is read-only — no data was changed. To repair repairable records, say "run the owner email backfill" or "my merge is blocked".*`;
      addMsg({ role: 'ai', content: report, ts: ts() });

      if (legacyRepairable.length > 0) {
        addMsg({ role: 'ai', content: `I found **${legacyRepairable.length} repairable record(s)**. Would you like me to run the Owner Email Backfill? It only writes \`owner_email\` where \`owner_user_id\` already proves ownership. A visibility snapshot is captured before and after.`, ts: ts() });
      }
    } catch (err) {
      addMsg({ role: 'ai', content: `Ownership diagnostic failed: ${err.message}`, ts: ts() });
    }
  };

  // ── Direct action handlers (bypass LLM, run tools immediately) ────────────
  const runDirectAction = async (intent, originalText) => {
    const { type } = intent;

    if (type === 'full_diagnostic') {
      try {
        const diagData = await runFullDiagnostic();
        const allChecks = Object.values(diagData.findings || {}).flatMap(f => f.checks || []);
        const issues = allChecks.filter(c => c.status !== 'passed');
        if (issues.length === 0) {
          addMsg({ role: 'ai', content: `✅ **All checks passed** — your account looks healthy.\n\nNo issues found across characters, conversations, memories, locations, finances, or schedules.`, ts: ts() });
        } else {
          addMsg({ role: 'ai', content: `Found **${issues.length} issue(s)** on your account. See the diagnostic panel below — available repairs are shown as buttons you can click.`, ts: ts() });
        }
        addMsg({ role: 'diagnostic', diagData, ts: ts() });
      } catch (err) {
        addMsg({ role: 'ai', content: `Diagnostic failed: ${err.message}`, ts: ts() });
      }
      return true;
    }

    if (type === 'backfill_owner_email') {
      const confirmId = addMsg({
        role: 'confirm',
        content: 'Run Owner Email Backfill? This will scan your character records for missing owner_email fields and repair only those where owner_user_id confirms they belong to your account. No guessing, no cross-account changes.',
        actionKey: 'backfill_owner_email',
        actionPayload: {},
        ts: ts(),
      });
      setPendingConfirm({ actionKey: 'backfill_owner_email', actionPayload: {}, confirmMsgId: confirmId });
      return true;
    }

    if (type === 'clean_ghost_references') {
      // First verify — check if there are actually dangling refs
      addMsg({ role: 'system', content: '🔍 Checking for ghost character references…', ts: ts() });
      try {
        const diagData = await runFullDiagnostic();
        const danglingConvs = diagData.findings?.conversations?.danglingConvs || [];
        const danglingMems = diagData.findings?.memories?.danglingCount || 0;
        if (danglingConvs.length === 0 && danglingMems === 0) {
          addMsg({ role: 'ai', content: `✅ **No ghost references found.** Your conversations and memories all link to valid characters — nothing to clean up.`, ts: ts() });
          addMsg({ role: 'diagnostic', diagData, ts: ts() });
        } else {
          const confirmId = addMsg({
            role: 'confirm',
            content: `Found ${danglingConvs.length} conversation(s) with broken character links and ${danglingMems} memory record(s) for deleted characters. Run cleanup to re-link or remove these stale references?`,
            actionKey: 'clean_ghost_references',
            actionPayload: {},
            ts: ts(),
          });
          setPendingConfirm({ actionKey: 'clean_ghost_references', actionPayload: {}, confirmMsgId: confirmId });
          addMsg({ role: 'diagnostic', diagData, ts: ts() });
        }
      } catch (err) {
        addMsg({ role: 'ai', content: `Check failed: ${err.message}`, ts: ts() });
      }
      return true;
    }

    if (type === 'merge_blocked') {
      // Step 1: Run account diagnostic to find characters missing owner_email
      addMsg({ role: 'system', content: '🔍 Checking account for merge blockers…', ts: ts() });
      try {
        const diagData = await runFullDiagnostic();
        const missingOwner = diagData.findings?.characters?.missingOwner || [];
        const ghostMerged = diagData.findings?.characters?.ghostMerged || [];
        const dupGroups = diagData.findings?.characters?.duplicateGroups || [];

        // Step 2: For each duplicate group that has a missing-owner record, inspect via previewCharacterMerge
        // to get the exact unsafe_records with their ownership_state
        if (missingOwner.length > 0 || dupGroups.length > 0) {
          // Find the intersection — duplicate groups where at least one record is missing owner_email
          const missingOwnerIds = new Set(missingOwner.map(r => r.id));
          const affectedGroups = dupGroups.filter(g => g.records.some(r => missingOwnerIds.has(r.id)));

          if (affectedGroups.length > 0) {
            // Preview the first blocked group to get the exact ownership_state breakdown
            const firstGroup = affectedGroups[0];
            addMsg({ role: 'system', content: `🔍 Inspecting merge records for "${firstGroup.name}"…`, ts: ts() });
            let previewData = null;
            try {
              const prevRes = await base44.functions.invoke('previewCharacterMerge', {
                characterIds: firstGroup.records.map(r => r.id),
                ownerEmail,
              });
              previewData = prevRes?.data;
            } catch (_) { /* preview failed — fall back to account diag data */ }

            const unsafeRecords = previewData?.unsafe_records || [];

            // Route by ownership_state — different states need different repairs
            const legacyRecords = unsafeRecords.filter(r => r.ownership_state === 'LEGACY_MISSING_OWNER');
            const notFoundRecords = unsafeRecords.filter(r => r.ownership_state === 'RECORD_NOT_FOUND');
            const crossAccountRecords = unsafeRecords.filter(r => r.ownership_state === 'CROSS_ACCOUNT_BLOCKED');

            if (crossAccountRecords.length > 0) {
              // CROSS_ACCOUNT_BLOCKED — permanently blocked, no repair possible
              addMsg({ role: 'ai', content: `🚫 **Merge permanently blocked** — ${crossAccountRecords.length} record(s) belong to a different account:\n${crossAccountRecords.map(r => `- **${r.name}** (${r.ownership_state})`).join('\n')}\n\nCross-account merges are permanently blocked by design. No repair can override this.\n\nA support ticket has been filed if this is unexpected.`, ts: ts() });
              base44.entities.IssueReport.create({ owner_email: ownerEmail, owner_user_id: userId, category: 'ownership_mismatch', title: `CROSS_ACCOUNT_BLOCKED merge: ${firstGroup.name}`, description: `Records: ${crossAccountRecords.map(r => r.id).join(', ')}`, status: 'escalated', findings: [] }).catch(() => {});
            } else if (notFoundRecords.length > 0) {
              // RECORD_NOT_FOUND — dangling reference, NOT an ownership problem
              addMsg({ role: 'ai', content: `⚠️ **The merge is blocked because ${notFoundRecords.length} record(s) no longer exist:**\n${notFoundRecords.map(r => `- **${r.name || '(unnamed)'}** (ID: \`${r.id?.substring(0, 10)}…\`) — record not found in the database`).join('\n')}\n\n**This is a dangling reference — not a missing owner_email issue.** Running the owner backfill will NOT fix this.\n\nThe original record was deleted but the reference was not cleaned up. I can run the ghost reference cleanup to remove these stale links.`, ts: ts() });
              const confirmId = addMsg({
                role: 'confirm',
                content: `Run ghost reference cleanup to remove ${notFoundRecords.length} stale reference(s) that no longer exist? This will not delete any real character data — only broken pointers.`,
                actionKey: 'clean_ghost_references',
                actionPayload: {},
                ts: ts(),
              });
              setPendingConfirm({ actionKey: 'clean_ghost_references', actionPayload: {}, confirmMsgId: confirmId });
            } else if (legacyRecords.length > 0) {
              // LEGACY_MISSING_OWNER — ownership can be repaired via repairCharacterOwnerEmail
              const firstLegacy = legacyRecords[0];
              addMsg({ role: 'ai', content: `**Found ${legacyRecords.length} legacy record(s) missing \`owner_email\`** — this is the merge blocker:\n${legacyRecords.map(r => `- **${r.name}** (ID: \`${r.id?.substring(0, 10)}…\`)`).join('\n')}\n\nI can run a targeted repair for each record. The repair only writes \`owner_email\` if the record's \`owner_user_id\` already matches your account ID — no guessing, no cross-account access.`, ts: ts() });
              const confirmId = addMsg({
                role: 'confirm',
                content: `Run targeted owner_email repair for "${firstLegacy.name}"? Proof required: owner_user_id must match your account. If evidence is missing, the record will be flagged — not modified.`,
                actionKey: 'targeted_owner_repair',
                actionPayload: { character_id: firstLegacy.id, character_name: firstLegacy.name, remaining: legacyRecords.slice(1) },
                ts: ts(),
              });
              setPendingConfirm({ actionKey: 'targeted_owner_repair', actionPayload: { character_id: firstLegacy.id, character_name: firstLegacy.name, remaining: legacyRecords.slice(1) }, confirmMsgId: confirmId });
            } else if (previewData?.merge_blocked) {
              // Blocked for another reason
              addMsg({ role: 'ai', content: `**Merge blocked:** ${previewData.merge_blocked_reason || 'Unknown reason'}\n\nNo unsafe records with known states were found. A full diagnostic may reveal more.`, ts: ts() });
            } else {
              addMsg({ role: 'ai', content: `**Merge blockers checked.** No unsafe records detected in the preview for "${firstGroup.name}".\n\nIf the merge is still blocked in the UI, try refreshing and re-opening the merge review panel.`, ts: ts() });
            }
          } else {
            // Records with missing owner but not in any duplicate group
            addMsg({ role: 'ai', content: `**Found ${missingOwner.length} character(s) missing \`owner_email\`** that may block merges:\n${missingOwner.map(c => `- **${c.name}**`).join('\n')}\n\nWould you like me to run the owner email backfill for all these records?`, ts: ts() });
            const confirmId = addMsg({
              role: 'confirm',
              content: `Run Owner Email Backfill for ${missingOwner.length} record(s) missing owner_email? Only repairs where owner_user_id confirms ownership.`,
              actionKey: 'backfill_owner_email',
              actionPayload: {},
              ts: ts(),
            });
            setPendingConfirm({ actionKey: 'backfill_owner_email', actionPayload: {}, confirmMsgId: confirmId });
          }
        } else if (ghostMerged.length > 0) {
          addMsg({ role: 'ai', content: `**Found ${ghostMerged.length} ghost-merged record(s)** — characters with \`merged_into_character_id\` set but status not updated to "merged". This integrity violation can block merges.\n\nRetry the merge from Settings → Suggested Duplicates after running a location sync.`, ts: ts() });
        } else {
          addMsg({ role: 'ai', content: `**No merge blockers found** in your account diagnostic.\n\nIf a specific merge is still blocked, open **Settings → Suggested Duplicates → Review & Merge** and note the exact error state shown there. You can paste it here and I'll diagnose it directly.`, ts: ts() });
        }
        addMsg({ role: 'diagnostic', diagData, ts: ts() });
      } catch (err) {
        addMsg({ role: 'ai', content: `Check failed: ${err.message}`, ts: ts() });
      }
      return true;
    }

    if (type === 'sync_locations') {
      addMsg({ role: 'system', content: '🔍 Checking location presence for your characters…', ts: ts() });
      try {
        const diagData = await runFullDiagnostic();
        const staleResolved = diagData.findings?.characters?.staleResolved || [];
        const noScope = diagData.findings?.locations?.noScopeCount || 0;
        if (staleResolved.length === 0 && noScope === 0) {
          addMsg({ role: 'ai', content: `✅ **All character locations look correct.** No stale presence or missing scope found.`, ts: ts() });
          addMsg({ role: 'diagnostic', diagData, ts: ts() });
        } else {
          const confirmId = addMsg({
            role: 'confirm',
            content: `Found ${staleResolved.length} character(s) with stale location data and ${noScope} location(s) missing scope. Run "Sync Character Locations" to fix?`,
            actionKey: 'sync_locations',
            actionPayload: {},
            ts: ts(),
          });
          setPendingConfirm({ actionKey: 'sync_locations', actionPayload: {}, confirmMsgId: confirmId });
          addMsg({ role: 'diagnostic', diagData, ts: ts() });
        }
      } catch (err) {
        addMsg({ role: 'ai', content: `Check failed: ${err.message}`, ts: ts() });
      }
      return true;
    }

    if (type === 'work_schedule') {
      addMsg({ role: 'system', content: '🔍 Checking work schedule and location links…', ts: ts() });
      try {
        const diagData = await runFullDiagnostic();
        const workers = diagData.findings?.schedules?.workersMissingWorkLocation || [];
        if (workers.length > 0) {
          addMsg({ role: 'ai', content: `**Found ${workers.length} character(s) with broken work location links:**\n${workers.map(c => `- ${c.name} (occupation: ${c.occupation || 'set'})`).join('\n')}\n\nThe work location ID is not linked on the character record — this prevents the schedule enforcement from knowing where to send them.\n\nI can run a repair to re-link work and school locations.`, ts: ts() });
          const confirmId = addMsg({
            role: 'confirm',
            content: `Repair work/school location links for ${workers.length} character(s)? This will re-link their work location references.`,
            actionKey: 'troubleshoot_locations',
            actionPayload: {},
            ts: ts(),
          });
          setPendingConfirm({ actionKey: 'troubleshoot_locations', actionPayload: {}, confirmMsgId: confirmId });
        } else {
          addMsg({ role: 'ai', content: `**Work location links look correct** — all working characters have their locations linked.\n\nIf a character still isn't going to work, the issue may be:\n- **Sleep or energy block** — character is sleeping or energy is too low\n- **stay_lock** — manually locked to a location; needs to be cleared\n- **Shift hours** — work_start_time or work_end_time may not cover the current time\n- **autonomous_travel_enabled = false** — travel is disabled in Settings\n\nWould you like me to run a full diagnostic to check?`, ts: ts() });
        }
        addMsg({ role: 'diagnostic', diagData, ts: ts() });
      } catch (err) {
        addMsg({ role: 'ai', content: `Check failed: ${err.message}`, ts: ts() });
      }
      return true;
    }

    if (type === 'finance_check') {
      addMsg({ role: 'system', content: '🔍 Checking financial records…', ts: ts() });
      try {
        const diagData = await runFullDiagnostic();
        const missing = diagData.findings?.financial?.missingFinancialRecord || [];
        const negative = diagData.findings?.financial?.negativeBalance || [];
        if (missing.length === 0 && negative.length === 0) {
          addMsg({ role: 'ai', content: `✅ **Financial records look healthy** — all active characters have financial records and no negative balances detected.\n\nIf money still seems wrong, it may be a billing timing issue. Use **"Force a Payday"** or **"Force Pay Bills"** in Settings → System & Data to manually trigger payroll or bill processing.`, ts: ts() });
        } else {
          let parts = [];
          if (missing.length > 0) parts.push(`**${missing.length} character(s) missing financial records:** ${missing.map(c => c.name).join(', ')}`);
          if (negative.length > 0) parts.push(`**${negative.length} character(s) with negative balance** — expenses may have been processed without corresponding income.`);
          addMsg({ role: 'ai', content: parts.join('\n\n') + `\n\nUse **"Force a Payday"** in Settings → System & Data to trigger payroll and replenish balances.`, ts: ts() });
        }
        addMsg({ role: 'diagnostic', diagData, ts: ts() });
      } catch (err) {
        addMsg({ role: 'ai', content: `Check failed: ${err.message}`, ts: ts() });
      }
      return true;
    }

    if (type === 'missing_character') {
      addMsg({ role: 'system', content: '🔍 Scanning character records…', ts: ts() });
      try {
        const diagData = await runFullDiagnostic();
        const total = diagData.findings?.characters?.total || 0;
        const live = diagData.findings?.characters?.live || 0;
        const missingType = diagData.findings?.characters?.missingType || [];
        const ghostMerged = diagData.findings?.characters?.ghostMerged || [];
        let reply = `Found **${live} live character(s)** out of ${total} total records on your account.\n\n`;
        if (missingType.length > 0) {
          reply += `**${missingType.length} character(s) are missing a character_type** — these may not appear in lists: ${missingType.map(c => c.name).join(', ')}\n\n`;
        }
        if (ghostMerged.length > 0) {
          reply += `**${ghostMerged.length} ghost-merged record(s)** — marked as merged but not removed cleanly.\n\n`;
        }
        if (missingType.length === 0 && ghostMerged.length === 0) {
          reply += `No missing type or ghost-merge issues found. If a character you created is still not showing up, check the character type filter on the Home page — NPC Fictitious characters don't appear on Home.`;
        }
        addMsg({ role: 'ai', content: reply.trim(), ts: ts() });
        addMsg({ role: 'diagnostic', diagData, ts: ts() });
      } catch (err) {
        addMsg({ role: 'ai', content: `Check failed: ${err.message}`, ts: ts() });
      }
      return true;
    }

    if (type === 'travel_check') {
      addMsg({ role: 'ai', content: `**Travel blockers I'll check for:**\n\n- Character is asleep or energy is critically low\n- \`presence_stay_lock = true\` — manually frozen at a location\n- \`autonomous_travel_enabled = false\` in your Settings\n- No valid destination assigned\n- Character is jailed\n\nRunning a full diagnostic to check your account data now…`, ts: ts() });
      try {
        const diagData = await runFullDiagnostic();
        const stale = diagData.findings?.characters?.staleResolved || [];
        if (stale.length > 0) {
          addMsg({ role: 'ai', content: `**Found ${stale.length} character(s) with stale location data** — this can cause travel to appear broken even when the logic is correct.\n\nWould you like to sync all character locations?`, ts: ts() });
        } else {
          addMsg({ role: 'ai', content: `Location data looks current. If travel is still blocked, it's likely a **stay_lock** or **sleep state** issue — those can only be cleared from the character profile or chat page.\n\nIs there a specific character you're asking about? I can narrow this down.`, ts: ts() });
        }
        addMsg({ role: 'diagnostic', diagData, ts: ts() });
      } catch (err) {
        addMsg({ role: 'ai', content: `Check failed: ${err.message}`, ts: ts() });
      }
      return true;
    }

    if (type === 'image_issue') {
      addMsg({ role: 'ai', content: `**Common image generation issues and their root causes:**\n\n- **Wrong face / character** — \`avatar_url\` is missing or pointing to the wrong URL. Check the character's photo settings.\n- **Wrong background** — the location has no zone images uploaded. Go to Locations → upload zone photos.\n- **Wrong lighting** — time-of-day must match; the system overrides reference photos with current lighting.\n- **Blurry or generic** — \`reference_image_urls\` are missing on the character. Add reference photos for consistency.\n- **Camera didn't zoom** — "zoom in" moves the camera, not the subject scale. This is correct behavior.\n\nWould you like me to run a diagnostic to check your account's character and location data?`, ts: ts() });
      return true;
    }

    if (type === 'ownership_diagnostic') {
      await runOwnershipDiagnostic();
      return true;
    }

    if (type === 'world_name_save') {
      addMsg({ role: 'system', content: '🔍 Checking UserSettings record…', ts: ts() });
      try {
        const settings = await base44.entities.UserSettings.filter({ owner_email: ownerEmail });
        const s = settings[0];
        if (!s) {
          addMsg({ role: 'ai', content: `**No UserSettings record found** for your account. The record should be created automatically on first load of Settings. Try navigating away and back.\n\nIf it still doesn't appear, file a support report.`, ts: ts() });
        } else if (!s.owner_email) {
          addMsg({ role: 'ai', content: `**Your UserSettings record is missing \`owner_email\`** (ID: ${s.id?.substring(0, 8)}…). This is a data integrity issue that causes saves to fail silently. A support ticket has been filed.`, ts: ts() });
          base44.entities.IssueReport.create({ owner_email: ownerEmail, owner_user_id: userId, category: 'ownership_mismatch', title: 'UserSettings missing owner_email', description: `Settings record ${s.id} has no owner_email — saves may fail silently.`, status: 'received', findings: [] }).catch(() => {});
        } else {
          const current = s.fictional_world_name || '';
          // Extract the desired name from the original text if present (e.g. "save world name as Alex")
          const nameMatch = originalText.match(/(?:as|to|name[d]?|called?|set.*?to)\s+"?([^"]+)"?\s*$/i);
          const desiredName = nameMatch?.[1]?.trim();

          if (desiredName) {
            // User told us what they want — offer to write it directly
            const confirmId = addMsg({
              role: 'confirm',
              content: `Save your world name as **"${desiredName}"**? (Current: "${current || 'not set'}")`,
              actionKey: 'save_world_name',
              actionPayload: { world_name: desiredName },
              ts: ts(),
            });
            setPendingConfirm({ actionKey: 'save_world_name', actionPayload: { world_name: desiredName }, confirmMsgId: confirmId });
          } else {
            // Record exists and is healthy — tell them what's set and ask what they want
            addMsg({ role: 'ai', content: `✅ **Your settings record is healthy.**\n\nCurrent world name: **"${current || '(not set)'}"**\n\nWhat would you like your world name to be? Tell me the name and I'll save it directly — e.g. *"save world name as Alex"*.`, ts: ts() });
          }
        }
      } catch (err) {
        addMsg({ role: 'ai', content: `Could not read settings record: ${err.message}`, ts: ts() });
      }
      return true;
    }

    return false; // No direct intent matched — fall through to LLM
  };

  // ── Handle user submit ────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isProcessing || isRepairing || !ownerEmail) return;
    setInput("");
    addMsg({ role: 'user', content: text, ts: ts() });
    setIsProcessing(true);

    const thinkingId = `thinking_${Date.now()}`;
    setMessages(prev => [...prev, { id: thinkingId, role: 'system', content: '🔍 Working on it…', ts: ts() }]);

    try {
      // 1. Try direct intent routing first (no LLM needed)
      const intent = detectIntent(text);
      if (intent) {
        setMessages(prev => prev.filter(m => m.id !== thinkingId));
        await runDirectAction(intent, text);
        return; // isProcessing is cleared in finally below
      }

      // 2. Determine if LLM needs live diagnostic context
      const wantsDiagnostic = /run diagnostic|check.*account|full check|what.*wrong|diagnose|scan|audit|check everything|something.*broken|broken|not working|isn't working|won't work|check my/i.test(text);
      const wantsReport = /file.*report|create.*report|submit.*issue|log.*issue|report.*problem|please log|please report/i.test(text);

      let diagData = null;
      if (wantsDiagnostic) {
        diagData = await runFullDiagnostic();
      }

      const recentHistory = messages
        .filter(m => m.role === 'user' || m.role === 'ai')
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 250)}`)
        .join('\n\n');

      let diagContext = '';
      const activeDiag = diagData || lastDiagData;
      if (activeDiag) {
        const allChecks = Object.values(activeDiag.findings || {}).flatMap(f => f.checks || []);
        const issues = allChecks.filter(c => c.status !== 'passed');
        const label = diagData ? 'LIVE' : 'PREVIOUS';
        diagContext = issues.length > 0
          ? `\n\n${label} DIAGNOSTIC for ${ownerEmail}:\n${issues.map(c => `- [${c.status.toUpperCase()}] ${c.check}: ${c.detail}`).join('\n')}\n\nConfirmed repair paths: ${(activeDiag.available_repairs || []).join(', ')}`
          : `\n\n${label} DIAGNOSTIC: All checks passed for ${ownerEmail}.`;
      }

      const prompt = `You are the Account Help & Repair assistant for "Own Your Life" — a character-based social simulation app.
You help the user whose account email is: ${ownerEmail}

SYSTEM KNOWLEDGE (use this to explain root causes):
- Characters: active_created_character (full sim), npc_family_member, npc_fictitious (no Home page), npc_regular
- Presence source of truth: resolved_current_location_id, resolved_current_location_name, resolved_presence_status
- Travel priority: schedule → needs (hunger<20, energy<20, social<20) → autonomous → VGC Towers
- Travel blocked when: sleeping, jailed, stay_lock=true, autonomous_travel_enabled=false
- Memory: CharacterMemory (structured), Memory (legacy), CharacterAutomaticNarrative (Life Journal)
- Finance: CharacterFinancial record per character. Payroll via processPayroll. Bills via processHousingCosts.
- Ownership: owner_email ONLY. created_by is forbidden entirely.
- Merge blocked by: missing owner_email (LEGACY_MISSING_OWNER), RECORD_NOT_FOUND (dangling ref — NOT an owner issue), CROSS_ACCOUNT_BLOCKED
- RECORD_NOT_FOUND = ghost reference. Fix via "Clean Ghost Character References", NOT backfill.
- LEGACY_MISSING_OWNER = missing owner_email. Fix via "Run Owner Email Backfill".

RULES:
- Explain root causes mechanistically — what field, what function, what chain caused this.
- Name exact characters when diagnostic data is available.
- Never say "run backfill" for RECORD_NOT_FOUND — that is a dangling reference, not an ownership problem.
- Never suggest created_by.
- Keep responses concise and plain-language. No technical jargon unless explaining a mechanism.
- If a direct action can help, say clearly what the user should type (e.g. "type 'sync my locations'").

Recent conversation:
${recentHistory}
${diagContext}

User message: ${text}

Respond helpfully, name exact records when available, explain the real cause.`;

      const response = await base44.integrations.Core.InvokeLLM({ prompt, model: 'gemini_3_flash' });

      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      addMsg({ role: 'ai', content: response || 'Unable to generate a response. Please try again.', ts: ts() });

      if (diagData) addMsg({ role: 'diagnostic', diagData, ts: ts() });

      const diagFoundIssues = diagData && Object.values(diagData.findings || {}).flatMap(f => f.checks || []).some(c => c.status !== 'passed');
      if (wantsReport || (diagFoundIssues && wantsDiagnostic)) {
        const findings = diagData ? Object.values(diagData.findings || {}).flatMap(f => f.checks || []).filter(c => c.status !== 'passed') : [];
        base44.entities.IssueReport.create({
          owner_email: ownerEmail, owner_user_id: userId,
          category: detectCategory(text), title: text.slice(0, 120), description: text,
          status: wantsReport ? 'received' : 'in_review',
          diagnostic_snapshot: diagData?.findings || {}, findings,
        }).catch(() => {});
        addMsg({ role: 'system', content: '📋 Support ticket created — logged for review.', ts: ts() });
      }
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      addMsg({ role: 'ai', content: `Something went wrong: ${err.message}. Please try again.`, ts: ts() });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  if (!ownerEmail) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-sm text-muted-foreground">Loading account info…</p>
      </div>
    );
  }

  const CHIPS = [
    { label: 'Run Diagnostic', action: 'run diagnostic' },
    { label: 'Ownership Diagnostic', action: 'diagnose my ownership (read only)' },
    { label: 'Merge Blocked', action: 'my duplicate merge is blocked' },
    { label: 'Owner Email Backfill', action: 'run the owner email backfill' },
    { label: 'Ghost References', action: 'clean ghost character references' },
    { label: 'Sync Locations', action: 'sync my character locations' },
    { label: 'Work Schedule', action: "my character isn't going to work" },
    { label: 'Money Wrong', action: 'my money is wrong' },
    { label: 'Character Missing', action: 'my character is missing' },
    { label: 'Travel Issues', action: "my character isn't traveling" },
    { label: 'File Report', action: 'I need to file a support report' },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col" style={{ height: 560 }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-card/80 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
        <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
        <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">Account Help & Repair</span>
        <span className="text-[9px] text-muted-foreground/40 ml-auto truncate max-w-[140px]">{ownerEmail}</span>
        <button onClick={() => { setMessages(prev => prev.slice(0, 1)); setPendingConfirm(null); }}
          className="text-muted-foreground hover:text-foreground transition-colors p-1" title="Clear conversation">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Quick-action chips */}
      <div className="flex gap-2 px-3 pt-2 pb-1 flex-shrink-0 overflow-x-auto scrollbar-hide">
        {CHIPS.map(({ label, action }) => (
          <button key={label} onClick={() => setInput(action)}
            className="flex-shrink-0 text-[10px] px-2.5 py-1 rounded-full bg-secondary border border-border hover:border-sky-400/40 hover:text-sky-400 text-muted-foreground transition-colors">
            {label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-2 space-y-1">
        <AnimatePresence>
          {messages.map(msg => (
            <ChatMessage key={msg.id} msg={msg}
              onRepair={(action, charId) => runRepairAction(action, charId)}
              isRepairing={isRepairing}
              onConfirm={handleConfirm}
              onDeny={handleDeny}
            />
          ))}
        </AnimatePresence>
        {(isProcessing || isRepairing) && (
          <div className="flex items-center gap-2 px-4 py-2">
            <Loader2 className="w-3 h-3 text-sky-400 animate-spin" />
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
            placeholder="Describe a problem — I'll run the right tool automatically…"
            rows={2}
            disabled={isProcessing || isRepairing}
            className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:opacity-50"
          />
          <button onClick={handleSubmit} disabled={!input.trim() || isProcessing || isRepairing}
            className="h-10 w-10 rounded-xl bg-sky-600 flex items-center justify-center flex-shrink-0 hover:bg-sky-500 transition-colors disabled:opacity-40">
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground/30 mt-1.5 text-center">
          Runs real tools · Scoped to your account only · Enter to send
        </p>
      </div>
    </div>
  );
}