import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HelpCircle, Send, Loader2, User, Brain, RefreshCw,
  CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Wrench, FileText
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import ReactMarkdown from "react-markdown";

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic sub-components (kept small and focused)
// ─────────────────────────────────────────────────────────────────────────────

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

// ── RepairButton — checks both bulk and per-character repair lists ────────────
function RepairButton({ repairAction, label, description, availableRepairs, availableCharacterRepairs, onRepair, isRepairing }) {
  const isLive = (availableRepairs || []).includes(repairAction) || (availableCharacterRepairs || []).includes(repairAction);
  if (!isLive) {
    return (
      <div className="p-2.5 rounded-xl border border-destructive/20 bg-destructive/5 text-xs">
        <p className="text-destructive font-medium">⚠ Repair path unavailable: <code>{repairAction}</code></p>
        <p className="text-muted-foreground mt-0.5">Not confirmed in the current diagnostic response. No changes can be made.</p>
      </div>
    );
  }
  return (
    <button
      onClick={() => onRepair(repairAction)}
      disabled={isRepairing}
      className="w-full flex items-center gap-2 p-3 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors text-xs text-left disabled:opacity-50"
    >
      <Wrench className="w-4 h-4 text-primary flex-shrink-0" />
      <div>
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

// ── Full diagnostic panel ─────────────────────────────────────────────────────
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
      {findings?.schedules && (
        <DiagSection
          title="Schedules & Work Links"
          checks={findings.schedules.checks || []}
          issueCount={(findings.schedules.checks || []).filter(c => c.status !== 'passed').length}
        />
      )}

      {errors?.length > 0 && (
        <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5 text-xs text-destructive space-y-1">
          <p className="font-semibold">Checks that could not run (fail visible):</p>
          {errors.map((e, i) => <p key={i}>{e.area}: {e.error}</p>)}
        </div>
      )}

      {/* Repair actions — driven entirely by live available_repairs returned from backend */}
      {hasIssues && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available Repairs</p>

          {findings?.characters?.duplicateGroupCount > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs">
              <p className="font-medium text-foreground">Duplicate Characters</p>
              <p className="text-muted-foreground mt-0.5">
                Use <strong>Suggested Duplicates → Review &amp; Merge</strong> in Settings to safely merge with full verification. Auto-merge is blocked — manual review required.
              </p>
            </div>
          )}

          {(findings?.characters?.staleResolved?.length > 0 || findings?.locations?.noScopeCount > 0) && (
            <RepairButton
              repairAction="fix_character_locations"
              label="Sync character location presence"
              description="Re-runs location enforcement for all your active characters"
              availableRepairs={available_repairs}
              availableCharacterRepairs={available_character_repairs}
              onRepair={onRepair}
              isRepairing={isRepairing}
            />
          )}

          {findings?.characters?.missingType?.length > 0 && (
            <RepairButton
              repairAction="repair_invalid_types"
              label="Repair missing character type classifications"
              description={`${findings.characters.missingType.length} character(s) need type assigned`}
              availableRepairs={available_repairs}
              availableCharacterRepairs={available_character_repairs}
              onRepair={onRepair}
              isRepairing={isRepairing}
            />
          )}

          {(findings?.conversations?.emptyCharIds?.length > 0 || findings?.conversations?.danglingConvs?.length > 0) && (
            <RepairButton
              repairAction="troubleshoot_locations"
              label="Troubleshoot conversation & location linkage"
              description={`${(findings.conversations.danglingConvs || []).length} conversation(s) have broken character links`}
              availableRepairs={available_repairs}
              availableCharacterRepairs={available_character_repairs}
              onRepair={onRepair}
              isRepairing={isRepairing}
            />
          )}

          {(findings?.schedules?.workersMissingWorkLocation?.length > 0 || findings?.schedules?.studentsMissingSchoolLocation?.length > 0) && (
            <RepairButton
              repairAction="troubleshoot_locations"
              label="Repair location links for workers/students"
              description="Re-links work and school location references"
              availableRepairs={available_repairs}
              availableCharacterRepairs={available_character_repairs}
              onRepair={onRepair}
              isRepairing={isRepairing}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Chat message renderer ─────────────────────────────────────────────────────
function ChatMessage({ msg, onRepair, isRepairing }) {
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

// ── Category classifier ───────────────────────────────────────────────────────
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

// ── Main SupportAssistant ─────────────────────────────────────────────────────
export default function SupportAssistant({ user }) {
  const ownerEmail = user?.email;
  const userId = user?.id;

  const [messages, setMessages] = useState([{
    id: 'welcome',
    role: 'ai',
    content: `Hi! I'm your **Account Help & Repair** assistant.\n\nI can run a real diagnostic against your account and help you fix issues with:\n- **Characters** — duplicates, missing types, no home assigned\n- **Conversations & chats** — broken links, dangling references\n- **Memories** — unresolved identities, dangling records\n- **Locations** — stale presence, missing scope\n- **Financial** — missing records, negative balances\n- **Schedules** — workers/students missing location links\n\nAll checks run against your account only.\n\nType a problem or say **"run diagnostic"** to start.`,
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

  // ── Run full diagnostic via live backend function ──────────────────────────
  const runFullDiagnostic = async () => {
    addMessage({ role: 'system', content: '🔍 Running full account diagnostic…', ts: ts() });
    const res = await base44.functions.invoke('userAccountDiagnostic', { categories: 'all' });
    const diagData = res?.data;
    if (!diagData) throw new Error('Diagnostic returned no data — function may have failed');
    setLastDiagData(diagData);
    return diagData;
  };

  // ── Repair dispatch — repair_action must be in diagData.available_repairs ──
  const handleRepair = async (repair_action, repair_character_id = null) => {
    // Verify against last known available_repairs before calling backend
    // This prevents calling paths that were not confirmed in the last diagnostic run
    if (lastDiagData?.available_repairs && !lastDiagData.available_repairs.includes(repair_action)) {
      // Per-character repairs are in available_character_repairs
      const isCharRepair = (lastDiagData?.available_character_repairs || []).includes(repair_action);
      if (!isCharRepair) {
        addMessage({
          role: 'ai',
          content: `⚠️ I cannot run repair path \`${repair_action}\` — it was not confirmed as available in the last diagnostic response. No changes were made.`,
          ts: ts(),
        });
        return;
      }
    }

    setIsRepairing(true);
    addMessage({ role: 'system', content: `⚙️ Running repair: ${repair_action}…`, ts: ts() });
    try {
      const payload = { categories: 'none', repair_action };
      if (repair_character_id) payload.repair_character_id = repair_character_id;

      const res = await base44.functions.invoke('userAccountDiagnostic', payload);
      const result = res?.data?.repair;

      if (result?.blocked) {
        addMessage({
          role: 'ai',
          content: `**Repair blocked:** ${result.reason}\n\nNo changes were made. A support report has been filed.`,
          ts: ts(),
        });
        // Create IssueReport for blocked repair
        base44.entities.IssueReport.create({
          owner_email: ownerEmail,
          owner_user_id: userId,
          category: 'other',
          title: `Repair blocked: ${repair_action}`,
          description: result.reason,
          status: 'repair_pending',
          findings: [],
        }).catch(() => {});
      } else if (result?.error) {
        addMessage({ role: 'ai', content: `**Repair encountered an error:** ${result.error}`, ts: ts() });
      } else {
        addMessage({
          role: 'ai',
          content: `**Repair complete** ✓\n\nAction: \`${repair_action}\`\n${typeof result?.result === 'object' ? JSON.stringify(result.result, null, 2).slice(0, 400) : (result?.result || 'Done.')}`,
          ts: ts(),
        });
        // Re-run diagnostic after repair to verify state
        addMessage({ role: 'system', content: '🔍 Re-running diagnostic to verify repair…', ts: ts() });
        const verifyData = await runFullDiagnostic();
        addMessage({
          role: 'diagnostic',
          diagData: verifyData,
          ts: ts(),
        });
      }
    } catch (e) {
      addMessage({ role: 'ai', content: `Repair failed: ${e.message}. No changes were made.`, ts: ts() });
    } finally {
      setIsRepairing(false);
    }
  };

  // ── Handle user submit ────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isProcessing || !ownerEmail) return;
    setInput("");
    addMessage({ role: 'user', content: text, ts: ts() });
    setIsProcessing(true);

    const thinkingId = `thinking_${Date.now()}`;
    setMessages(prev => [...prev, { id: thinkingId, role: 'system', content: '🔍 Working on it…', ts: ts() }]);

    try {
      const wantsDiagnostic = /run diagnostic|check.*account|full check|what.*wrong|diagnose|scan|audit|check everything|something.*broken|broken|not working|isn't working|won't work|check my/i.test(text);
      const wantsReport = /file.*report|create.*report|submit.*issue|log.*issue|report.*problem|please log|please report/i.test(text);
      // Behavioral/explanatory questions — needs real context but no scan required
      const wantsBehaviorExplanation = /why (did|didn't|is|isn't|does|doesn't|won't|can't)|how does|what.*cause|explain|not traveling|not going|not responding|wrong image|looks wrong|not saving|not updating|wrong location|wrong character|stuck|missing/i.test(text);

      let diagData = null;

      if (wantsDiagnostic) {
        diagData = await runFullDiagnostic();
      }

      // Build context for LLM — always include what was actually found, not invented
      const recentHistory = messages
        .filter(m => m.role === 'user' || m.role === 'ai')
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 250)}`)
        .join('\n\n');

      let diagContext = '';
      const activeDiag = diagData || (wantsBehaviorExplanation ? lastDiagData : null);
      if (activeDiag) {
        const allChecks = Object.values(activeDiag.findings || {}).flatMap(f => f.checks || []);
        const issues = allChecks.filter(c => c.status !== 'passed');
        const label = diagData ? 'LIVE' : 'PREVIOUS';
        diagContext = issues.length > 0
          ? `\n\n${label} DIAGNOSTIC RESULTS for ${ownerEmail}:\n${issues.map(c => `- [${c.status.toUpperCase()}] ${c.check}: ${c.detail}`).join('\n')}\n\nAvailable repair paths confirmed by backend: ${(activeDiag.available_repairs || []).join(', ')}`
          : `\n\n${label} DIAGNOSTIC: All checks passed for ${ownerEmail}.`;
      } else if (lastDiagData) {
        diagContext = `\n\n(Previous diagnostic: ${lastDiagData.summary} at ${lastDiagData.checked_at})`;
      }

      // LLM only references functions that are confirmed in the diagnostic response
      const confirmedRepairs = diagData?.available_repairs || lastDiagData?.available_repairs || [];
      const repairList = confirmedRepairs.length > 0
        ? `\n\nCONFIRMED LIVE REPAIR PATHS (from current diagnostic response — do not invent others):\n${confirmedRepairs.map(r => `- ${r}`).join('\n')}`
        : '';

      const prompt = `You are the Account Help & Repair assistant for "Own Your Life" — a character-based social simulation app.

You help the user whose account email is: ${ownerEmail}

═══════════════════════════════════════
APP SYSTEM KNOWLEDGE
═══════════════════════════════════════

CHARACTER TYPES:
- active_created_character: Full simulation — needs, schedule, travel, emotions, memories, finances. Appears on Home page.
- npc_family_member: Family NPC. Chat-capable, limited schedule, no full needs simulation.
- npc_fictitious: Background/world NPC. Limited interaction. Does NOT appear on Home.
- npc_regular: Standard NPC. Shared world presence.

PRESENCE & LOCATION:
- One character = one resolved presence (never omnipresent).
- Source of truth: resolved_current_location_id, resolved_current_location_name, resolved_presence_status.
- Priority chain: schedule (work/school) → needs → autonomous travel → VGC Towers default.
- presence_stay_lock = true → character is frozen at that location; nothing overrides it until cleared.
- VGC Towers = per-user private instance. Characters return there when no other destination is active.
- Travel triggers: scheduled shift start/end, needs critically low (hunger<20→food, energy<20→home, social<20→go out), autonomous_travel_enabled=true.
- Travel blocked when: sleeping, jailed, stay_lock=true, autonomous_travel_enabled=false, no valid destination.

NEEDS SYSTEM (drives behavior):
- Needs: hunger, energy, health, stress, social, fun, hygiene, comfort (0–100). Decay over time.
- Low needs trigger: movement changes, dialogue tone shifts, emotional state changes.
- Needs are simulated by simulateActiveCharacterNeeds (scheduled function).
- If a character seems "stuck" or not reacting normally, low or zero needs are a common root cause.

EMOTIONAL STATE:
- emotional_state field drives tone, responses, actions.
- States: calm, irritated, defensive, reflective, closed-off, joyful, anxious, sad, excited, overwhelmed, content, frustrated.
- Changes based on: life events, messages from user, needs state, schedule compliance.

MEMORY SYSTEM:
- CharacterMemory: structured records per character_id. Types: identity, relationship, event, preference, location, fact.
- Memory entity: older/simpler records.
- Life Journal (CharacterAutomaticNarrative): continuous timeline log.
- Memories give continuity across conversations. Missing memories = character "forgets."
- unresolved_identity = character mentioned someone the system hasn't linked yet.

IMAGE GENERATION:
- Avatar = identity source (face, age, body, skin). NEVER use as background.
- Background = current location + zone images.
- Camera moves, subject does NOT scale — "zoom in" = camera moves closer.
- Lighting must match time-of-day — overrides reference photos.
- Wrong image? Check: avatar_url set, reference_image_urls present, location has zone images.

DATA NOT SAVING / STUCK STATE:
- If edits don't persist: check if the write call succeeded, check for cache vs. live data mismatch, check if owner_email is present on the record.
- Profile edits reverting = usually a stale query cache re-loading old data over the new write.
- Location not sticking = resolved_current_location_id may be getting overwritten by the presence enforcement function on next run.
- Updates not showing in UI = React Query cache may need invalidation; the write succeeded but the UI is showing stale data.

CHARACTER CARD / LOCATION ERRORS:
- Characters showing wrong location = resolved_presence_status or resolved_current_location_name is stale. Run "Sync character location presence" repair.
- All characters showing "at work" = schedule enforcement override may be stuck. Check work schedule data and presence_stay_lock.
- User character card incorrect = user_presence_status in UserSettings may be stale.

FINANCE / MONEY ISSUES:
- Money not calculating = check if CharacterFinancial record exists for the character.
- Housing costs not applied = processHousingCosts function may not have run, or the location is missing rent_or_housing_cost.
- Hotel charges not applied = nightly_rate missing on the hotel LocationReference.
- Negative balance = check recurring_expenses vs income sources; may have been billed without receiving pay.
- Payroll manually triggered via "Force a Payday" in Settings → System & Data.

WORK / SCHEDULE FAILURES:
- Character not going to work = check: occupation set, current_work_location_id linked, work_days and work_start_time/work_end_time configured.
- Incorrect work times = check work schedule data on the character and the CharacterScheduleProfile if it exists.
- Schedule not applied = enforceCharacterWorkSchedule function may need to run for that character.

TRAVEL / MOVEMENT ISSUES:
- Not traveling when expected = check needs values (are they low enough to trigger movement?), check autonomous_travel_enabled in UserSettings.
- Traveling to wrong place = check travel_destination_location_id and whether needs-based or schedule-based logic determined the destination.
- Traveling at wrong time = check sleep state (sleeping blocks travel), check work schedule windows.

SCENES / MOMENTS:
- Wrong characters in scene = check selectedNpcIds used to build the scene.
- Dropdown selection not respected = scene prompt may not be correctly reading the selected character IDs.
- Moments not updating = check if life events are being written; run "event_tracking" troubleshoot check in Troubleshoot → Moments.

CHARACTER BEHAVIOR / QUIRKS:
- Inconsistent personality = check personality_traits, emotional_state, and recent CharacterMemory records.
- Unexpected emotional response = may be driven by emotional_triggers_high or emotional_baggage fields.
- Actions not matching state = needs system and emotional_state must align. Check if simulateActiveCharacterNeeds has run recently.

DUPLICATE / MERGE RULES:
- Duplicates detected by normalized name.
- Ghost merged = merged_into_character_id set but status ≠ 'merged' — integrity violation.
- Safe merge: Settings → "Suggested Duplicates → Review & Merge" ONLY. Never auto-merge.
- Merge remaps all conversations, messages, memories, life events, relationships.
- Never merge across accounts.

CONVERSATION LINKAGE:
- Conversations have character_ids array. Deleted character = dangling ID.
- Dangling = chat page may show errors or blank state.
- Fix: troubleshoot_locations repair.

OWNERSHIP RULES:
- owner_email = ONLY valid ownership proof.
- created_by = forbidden entirely.
- All data isolated per owner_email. Zero cross-account access.

═══════════════════════════════════════
STRICT RULES FOR YOUR RESPONSES:
═══════════════════════════════════════
- Only discuss this user's data (${ownerEmail}).
- Never reference created_by.
- Never promise a repair not confirmed in the live repair list.
- For duplicates: always direct to "Suggested Duplicates → Review & Merge" in Settings.
- Name exact characters/records when diagnostic data is available.
- Do not say "all looks fine" if warnings exist.
- If you cannot confirm a fix without re-running diagnostic, say so.
- When asked WHY something happened, explain the actual mechanism using the system knowledge above.
- If the issue could be a data problem (not just behavioral), tell the user to say "run diagnostic" so you can check their actual data.
${repairList}

Recent conversation:
${recentHistory}
${diagContext}

User message: ${text}

Respond with specific, honest, actionable information. Name exact characters and records. Explain root causes when asked about behavior. If repairs are available, name the repair_action key. If you cannot fix something, explain why and what the user should do next.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        model: 'gemini_3_flash',
      });

      setMessages(prev => prev.filter(m => m.id !== thinkingId));

      addMessage({ role: 'ai', content: response || 'Unable to generate a response. Please try again.', ts: ts() });

      // Always show diagnostic panel after running one
      if (diagData) {
        addMessage({ role: 'diagnostic', diagData, ts: ts() });
      }

      // IssueReport: only create when:
      // (a) user explicitly requests a report, OR
      // (b) diagnostic ran AND found real issues (not just general questions/explanations)
      const diagFoundIssues = diagData && Object.values(diagData.findings || {}).flatMap(f => f.checks || []).some(c => c.status !== 'passed');

      if (wantsReport || (diagFoundIssues && wantsDiagnostic)) {
        const category = detectCategory(text);
        const findings = diagData
          ? Object.values(diagData.findings || {}).flatMap(f => f.checks || []).filter(c => c.status !== 'passed')
          : [];

        base44.entities.IssueReport.create({
          owner_email: ownerEmail,
          owner_user_id: userId,
          category,
          title: text.slice(0, 120),
          description: text,
          status: wantsReport ? 'received' : 'in_review',
          diagnostic_snapshot: diagData?.findings || {},
          findings,
        }).catch(() => {});

        addMessage({ role: 'system', content: '📋 Support ticket created — logged for review.', ts: ts() });
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

      {/* Quick-action chips */}
      <div className="flex gap-2 px-3 pt-2 pb-1 flex-shrink-0 overflow-x-auto scrollbar-hide">
        {[
          { label: 'Run Diagnostic', action: 'run diagnostic' },
          { label: 'Travel Issues', action: 'why is my character not traveling?' },
          { label: 'Wrong Image', action: 'why does the generated image look wrong?' },
          { label: 'Money Issues', action: 'why is my character\'s money not correct?' },
          { label: 'Work Schedule', action: 'why isn\'t my character going to work?' },
          { label: 'Chat Issues', action: 'check my chat and message linkage' },
          { label: 'Behavior', action: 'why is my character acting differently than expected?' },
          { label: 'File Report', action: 'I have a problem I need to report' },
        ].map(({ label, action }) => (
          <button
            key={label}
            onClick={() => setInput(action)}
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
            <ChatMessage key={msg.id} msg={msg} onRepair={handleRepair} isRepairing={isRepairing} />
          ))}
        </AnimatePresence>
        {isProcessing && (
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