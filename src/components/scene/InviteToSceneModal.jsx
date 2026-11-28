import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, UserPlus, Loader2, Check, Clock, HelpCircle, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fetchUnifiedRoster, getInitial } from "@/lib/unifiedRosterUtils";
import { resolveCharacterContacts } from "@/lib/characterContactsResolver";
import { getSceneObserveCast } from "@/lib/sceneObserveCast";
import { isInfantCharacter } from "@/lib/characterAgeStage";
import { inviteRestrictionFor, resolveParentIds } from "@/lib/sceneInviteEligibility";

const DECISION_CONFIG = {
  coming_now: { icon: Check, color: "text-emerald-400", label: "On their way!" },
  coming_later: { icon: Clock, color: "text-amber-400", label: "Coming later" },
  maybe: { icon: HelpCircle, color: "text-yellow-400", label: "Maybe" },
  declined: { icon: XCircle, color: "text-red-400", label: "Can't make it" },
  // A baby is never invited on their own: they come with a parent, or stay behind.
  with_parent: { icon: Check, color: "text-emerald-400", label: "Coming with a parent" },
  staying: { icon: Clock, color: "text-muted-foreground", label: "Staying behind" },
};

function InviteeRow({ person, isSelected, onToggle, restriction = null }) {
  return (
    <button
      onClick={() => { if (!restriction) onToggle(person); }}
      disabled={!!restriction}
      className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${restriction ? "opacity-60 cursor-not-allowed" : "hover:bg-secondary"} ${isSelected ? "bg-primary/10" : ""}`}
    >
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? "bg-primary border-primary" : "border-border"}`}>
        {isSelected && <Check className="w-3 h-3 text-white" />}
      </div>
      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
        {person.avatar_url
          ? <img src={person.avatar_url} alt={person.name} className="w-full h-full object-cover" />
          : <span className="text-xs font-bold text-foreground">{getInitial(person.name)}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{person.name}</p>
        {person.subtitle && <p className="text-[10px] text-muted-foreground">{person.subtitle}</p>}
        {/* Why this person cannot be selected right now — never who else knows them. */}
        {restriction && <p className="text-[10px] text-amber-400/90 mt-0.5">{restriction}</p>}
      </div>
    </button>
  );
}

function InviteResult({ result }) {
  const config = DECISION_CONFIG[result.decision] || DECISION_CONFIG.declined;
  const Icon = config.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 items-start p-3 rounded-xl border border-border bg-secondary/30"
    >
      <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
        {result.avatar_url
          ? <img src={result.avatar_url} alt={result.inviteeName} className="w-full h-full object-cover" />
          : <span className="text-xs font-bold text-foreground">{getInitial(result.inviteeName)}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-xs font-semibold text-foreground">{result.inviteeName}</p>
          <div className={`flex items-center gap-1 ${config.color}`}>
            <Icon className="w-3 h-3" />
            <span className="text-[10px] font-medium">{config.label}</span>
          </div>
          {result.delay_minutes > 0 && (
            <span className="text-[10px] text-muted-foreground">~{result.delay_minutes}min</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground italic">"{result.response_text}"</p>
      </div>
    </motion.div>
  );
}

/**
 * InviteToSceneModal — canonical identity picker for inviting people to a scene.
 *
 * IDENTITY CONTRACT:
 * - All selectable invitees come from fetchUnifiedRoster (real Character records only).
 * - Every selectable person has a canonical_person_id (real Character.id).
 * - Unresolved people (needs_review from repairDiagnostics) are shown transparently,
 *   NOT as selectable invitees.
 * - No synthetic IDs (npc_family_*, npc_world_*) are ever passed to inviteCharacterToLocation.
 * - fictional_relationships[].person_name without a related_character_id is NOT selectable.
 * - family_members[] entries without _linked_character_id are NOT selectable.
 */
export default function InviteToSceneModal({ isOpen, onClose, location, characters, userDisplayName, initiator = null, onCharacterArrived }) {
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState([]);
  const [sent, setSent] = useState(false);
  const [roster, setRoster] = useState([]);
  const [loadStatus, setLoadStatus] = useState('idle'); // 'idle'|'loading'|'fresh'|'error'|'user_only'
  const [repairDiagnostics, setRepairDiagnostics] = useState([]);
  const [ownerEmail, setOwnerEmail] = useState(null);
  // Who the selected participants already know, read from the established contact graph.
  const [known, setKnown] = useState({ ids: new Set(), names: new Set() });

  // Taking part or watching — the same participation state the Scenes page reads. Opening
  // the page never counts as being present.
  const observeMode = new URLSearchParams(window.location.search).get("observe") === "1";

  const recordsById = useMemo(
    () => new Map((characters || []).filter((c) => c?.id).map((c) => [c.id, c])),
    [characters]
  );
  const recordFor = (person) => recordsById.get(person?.canonical_person_id) || null;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoadStatus('loading');

    base44.auth.me()
      .then(user => {
        if (!user?.email || cancelled) return;
        setOwnerEmail(user.email);
        return fetchUnifiedRoster(base44, user.email)
          .then(({ roster: r, repairDiagnostics: diag }) => {
            if (cancelled) return;
            // Exclude the user-self entry and the character doing the inviting
            const invitees = r.filter(e => !e.is_user && e.canonical_person_id !== initiator?.id);
            if (invitees.length === 0 && r.length <= 1) {
              setLoadStatus('user_only');
            } else {
              setLoadStatus('fresh');
            }
            setRoster(invitees);
            // RUNTIME PROOF LOG — readable in browser console when modal opens
            console.group('[InviteToSceneModal] Canonical roster loaded');
            console.log(`Total selectable invitees: ${invitees.length}`);
            invitees.forEach(e => console.log(
              `  SELECTABLE | canonical_person_id=${e.canonical_person_id} | name="${e.name}" | type=${e.character_type} | id_is_synthetic=${e.canonical_person_id?.startsWith('npc_') || e.canonical_person_id === '__user__'}`
            ));
            if (diag?.length > 0) {
              setRepairDiagnostics(diag);
              console.group(`[InviteToSceneModal] NOT selectable — needs_review (${diag.length})`);
              diag.forEach(d => console.warn(`  needs_review | name="${d.name}" | confidence=${d.confidence} | reason=${d.failure_reason}`));
              console.groupEnd();
            } else {
              console.log('[InviteToSceneModal] No needs_review entries.');
            }
            console.groupEnd();
          });
      })
      .catch(err => {
        console.error('[InviteToSceneModal] fetchUnifiedRoster failed:', err?.message);
        if (!cancelled) setLoadStatus('error');
      });

    return () => { cancelled = true; };
  }, [isOpen]);

  // WHO THE SCENE ALREADY KNOWS — only the participants currently selected in this
  // observed moment. Their established contacts (family, relationships, people in their
  // world, verified conversations) are the same contact graph the app already uses; no
  // relationship is added, inferred or scored here.
  const selectedParticipants = observeMode ? getSceneObserveCast() : [];
  const participantIds = selectedParticipants
    .filter((p) => p?.id && !p.isNpc && !String(p.id).startsWith("npc_"))
    .map((p) => p.id);
  const participantKey = participantIds.join(",");

  useEffect(() => {
    if (!isOpen || !observeMode || !ownerEmail || participantIds.length === 0) {
      setKnown({ ids: new Set(), names: new Set() });
      return;
    }
    let cancelled = false;
    Promise.all(
      selectedParticipants
        .filter((p) => participantIds.includes(p.id))
        .map((p) => resolveCharacterContacts(p, ownerEmail).catch(() => []))
    ).then((lists) => {
      if (cancelled) return;
      const ids = new Set();
      const names = new Set();
      lists.flat().forEach((contact) => {
        if (contact?.related_character_id) ids.add(contact.related_character_id);
        else if (contact?.person_name) names.add(contact.person_name.trim().toLowerCase());
      });
      setKnown({ ids, names });
    });
    return () => { cancelled = true; };
  }, [isOpen, observeMode, ownerEmail, participantKey]);

  const selectedIdSet = useMemo(
    () => new Set(selected.map((p) => p.canonical_person_id)),
    [selected]
  );

  // Eligibility is derived from the current selection and the current cast on every
  // render — never remembered — so selecting or deselecting a participant, switching
  // between taking part and observing, or selecting a parent takes effect immediately.
  const restrictions = useMemo(() => {
    const map = new Map();
    for (const entry of roster) {
      map.set(entry.canonical_person_id, inviteRestrictionFor({
        person: entry,
        record: recordsById.get(entry.canonical_person_id) || null,
        observeMode,
        selectedIds: selectedIdSet,
        knownIds: known.ids,
        knownNames: known.names,
        characters: characters || [],
      }));
    }
    return map;
  }, [roster, recordsById, observeMode, selectedIdSet, known, characters]);

  // A selection that has stopped being valid — a baby whose last selected parent was just
  // removed — is dropped at once, so it can never be submitted.
  useEffect(() => {
    if (selected.length === 0) return;
    if (!selected.some((p) => restrictions.get(p.canonical_person_id))) return;
    setSelected((prev) => prev.filter((p) => !restrictions.get(p.canonical_person_id)));
  }, [restrictions]);

  const handleRetry = () => {
    setRoster([]);
    setRepairDiagnostics([]);
    setLoadStatus('loading');
    base44.auth.me()
      .then(user => {
        if (!user?.email) return;
        return fetchUnifiedRoster(base44, user.email)
          .then(({ roster: r, repairDiagnostics: diag }) => {
            setRoster(r.filter(e => !e.is_user && e.canonical_person_id !== initiator?.id));
            setLoadStatus('fresh');
            setRepairDiagnostics(diag || []);
          });
      })
      .catch(() => setLoadStatus('error'));
  };

  const togglePerson = (person) => {
    setSelected(prev =>
      prev.find(p => p.canonical_person_id === person.canonical_person_id)
        ? prev.filter(p => p.canonical_person_id !== person.canonical_person_id)
        : [...prev, person]
    );
  };

  const handleSendInvites = async () => {
    if (selected.length === 0 || sending) return;
    setSending(true);
    const inviteResults = [];

    // Anything that stopped being eligible is never submitted.
    const eligible = selected.filter((p) => !restrictions.get(p.canonical_person_id));
    // A baby is never invited on their own: they are asked for through a selected parent,
    // who decides — with their own words — whether to bring them.
    const babies = eligible.filter((p) => isInfantCharacter(recordFor(p) || p));
    const adults = eligible.filter((p) => !isInfantCharacter(recordFor(p) || p));
    const babyParents = new Map(babies.map((b) => [
      b.canonical_person_id,
      resolveParentIds(recordFor(b) || b, characters || []),
    ]));
    const broughtBy = new Map();

    for (const person of adults) {
      // CANONICAL CONTRACT: only pass real canonical_person_id — never a synthetic ID
      const canonicalId = person.canonical_person_id;
      if (!canonicalId || canonicalId.startsWith('npc_') || canonicalId === '__user__') {
        console.warn('[InviteToSceneModal] BLOCKED: attempted to invite non-canonical person:', person.name, canonicalId);
        continue;
      }

      const accompanying = babies
        .filter((b) => (babyParents.get(b.canonical_person_id) || []).includes(canonicalId))
        .map((b) => b.canonical_person_id);

      try {
        const res = await base44.functions.invoke('inviteCharacterToLocation', {
          inviteeId: canonicalId,
          inviteeName: person.name,
          inviteeType: 'character',
          locationId: location.id,
          locationName: location.name,
          locationCategory: location.category,
          userDisplayName,
          // When a character is at the location without the user, the invitation is theirs.
          inviterName: initiator?.name || null,
          inviterCharacterId: initiator?.id || null,
          // Their own baby is part of this invitation, and whether they come along is
          // part of the parent's own answer.
          accompanyingCharacterIds: accompanying,
        });
        const data = res?.data || {};
        inviteResults.push({
          inviteeName: person.name,
          avatar_url: person.avatar_url,
          decision: data.decision || 'declined',
          delay_minutes: data.delay_minutes || 0,
          response_text: data.response_text || `${person.name} doesn't respond.`,
          inviteeId: canonicalId,
        });

        if (data.bringing_accompanying && ['coming_now', 'coming_later'].includes(data.decision)) {
          accompanying.forEach((id) => broughtBy.set(id, person.name));
        }

        // If coming now, notify parent so they can add to scene
        if (data.decision === 'coming_now' && onCharacterArrived) {
          onCharacterArrived({
            id: canonicalId,
            name: person.name,
            avatar_url: person.avatar_url,
            character_type: person.character_type,
            personality_summary: person.appearance_notes || '',
          });
        }
      } catch {
        inviteResults.push({
          inviteeName: person.name,
          avatar_url: person.avatar_url,
          decision: 'declined',
          delay_minutes: 0,
          response_text: `${person.name} doesn't respond.`,
        });
      }
    }

    // The baby's outcome is their parent's outcome — never a decision of their own.
    for (const baby of babies) {
      const parentName = broughtBy.get(baby.canonical_person_id);
      inviteResults.push({
        inviteeName: baby.name,
        avatar_url: baby.avatar_url,
        decision: parentName ? 'with_parent' : 'staying',
        delay_minutes: 0,
        response_text: parentName
          ? `${parentName} is bringing them along.`
          : `Staying behind — no parent is bringing them this time.`,
        inviteeId: baby.canonical_person_id,
      });
      if (parentName && onCharacterArrived) {
        const babyRecord = recordFor(baby) || {};
        onCharacterArrived({
          id: baby.canonical_person_id,
          name: baby.name,
          avatar_url: baby.avatar_url,
          character_type: baby.character_type,
          personality_summary: babyRecord.appearance_notes || '',
        });
      }
    }

    setResults(inviteResults);
    setSent(true);
    setSending(false);
  };

  const handleClose = () => {
    setSelected([]);
    setResults([]);
    setSent(false);
    onClose();
  };

  if (!isOpen) return null;

  // Split roster into active created characters and other characters for display grouping
  const activeChars = roster.filter(e => e.character_type === 'active_created_character');
  const otherChars = roster.filter(e => e.character_type !== 'active_created_character');

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-primary" />
                  Invite someone here
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {initiator ? `${initiator.name} asks them to come to ${location?.name}` : `Ask them to come to ${location?.name}`}
                </p>
              </div>
              <button onClick={handleClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Results view */}
            {sent ? (
              <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                <p className="text-xs text-muted-foreground mb-3">Here's how they responded:</p>
                {results.map((r, i) => <InviteResult key={i} result={r} />)}
              </div>
            ) : (
              <>
                {/* Load error states */}
                {loadStatus === 'error' && (
                  <div className="mx-4 mt-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1.5">
                    <p className="font-medium">Character list failed to load.</p>
                    <button onClick={handleRetry} className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive font-medium transition-colors">
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  </div>
                )}
                {loadStatus === 'user_only' && (
                  <div className="mx-4 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400 flex items-center justify-between gap-2">
                    <span>Character list may be incomplete.</span>
                    <button onClick={handleRetry} className="flex items-center gap-1 font-medium flex-shrink-0">
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  </div>
                )}

                {/* Repair diagnostics — transparent, not as selectable items */}
                {repairDiagnostics.length > 0 && (
                  <div className="mx-4 mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-400 space-y-1">
                    <p className="font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Some people need review before they can be invited:
                    </p>
                    {repairDiagnostics.slice(0, 3).map((d, i) => (
                      <p key={i} className="text-amber-400/80">• <span className="font-medium">{d.name}</span> — {d.failure_reason || 'Needs higher-confidence resolution'}</p>
                    ))}
                    {repairDiagnostics.length > 3 && (
                      <p className="text-amber-400/60">…and {repairDiagnostics.length - 3} more</p>
                    )}
                  </div>
                )}

                {/* People list */}
                <div className="max-h-72 overflow-y-auto">
                  {loadStatus === 'loading' ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                    </div>
                  ) : roster.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">No one available to invite</p>
                  ) : (
                    <>
                      {/* Active characters */}
                      {activeChars.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 border-b border-border/50">
                            <p className="text-[9px] font-semibold text-primary/70 uppercase tracking-wider">Active Characters</p>
                          </div>
                          {activeChars.map(entry => (
                            <InviteeRow
                              key={entry.canonical_person_id}
                              person={{
                                canonical_person_id: entry.canonical_person_id,
                                name: entry.name,
                                avatar_url: entry.avatar_url,
                                character_type: entry.character_type,
                                subtitle: entry.character_type?.replace(/_/g, ' ') || 'Active',
                              }}
                              isSelected={!!selected.find(p => p.canonical_person_id === entry.canonical_person_id)}
                              onToggle={togglePerson}
                              restriction={restrictions.get(entry.canonical_person_id) || null}
                            />
                          ))}
                        </>
                      )}

                      {/* Other characters (NPCs, family members with canonical IDs) */}
                      {otherChars.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                            <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Other Characters</p>
                          </div>
                          {otherChars.map(entry => (
                            <InviteeRow
                              key={entry.canonical_person_id}
                              person={{
                                canonical_person_id: entry.canonical_person_id,
                                name: entry.name,
                                avatar_url: entry.avatar_url,
                                character_type: entry.character_type,
                                subtitle: entry.character_type?.replace(/_/g, ' ') || 'NPC',
                              }}
                              isSelected={!!selected.find(p => p.canonical_person_id === entry.canonical_person_id)}
                              onToggle={togglePerson}
                              restriction={restrictions.get(entry.canonical_person_id) || null}
                            />
                          ))}
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Send button */}
                <div className="border-t border-border p-4">
                  <button
                    onClick={handleSendInvites}
                    disabled={selected.length === 0 || sending}
                    className="w-full h-10 rounded-2xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2 transition-opacity"
                  >
                    {sending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending invites...</>
                    ) : (
                      <><UserPlus className="w-4 h-4" /> Invite {selected.length > 0 ? `${selected.length} person${selected.length > 1 ? 's' : ''}` : 'someone'}</>
                    )}
                  </button>
                </div>
              </>
            )}

            {sent && (
              <div className="border-t border-border p-4">
                <button onClick={handleClose} className="w-full h-9 rounded-2xl bg-secondary text-foreground text-sm font-medium">
                  Done
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}