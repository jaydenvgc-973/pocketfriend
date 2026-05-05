import { useState, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";

/**
 * useNPCEvolutionTracker
 *
 * Manages the 4-level NPC evolution lifecycle entirely in session state.
 * No data is written to the database without explicit user intent.
 *
 * Level 1 — Background: no name, atmosphere only, fades on scene exit
 * Level 2 — Named Temporary: NPC introduced themselves via strict pattern, fades on scene exit
 * Level 3 — Known Contact: 3+ meaningful exchanges + name confirmed, STILL session only
 *            Persistence to CasualContact requires explicit user action (see intentActions below)
 * Level 4 — npc_fictitious: user clicks "Save this person" → duplicate check → Character creation
 *
 * FADE RULE: Level 1 and Level 2 state is never written to the database.
 * If the user takes no persistence action during the scene, all NPC state is lost on exit.
 *
 * OWNERSHIP: All persistence operations are scoped strictly to owner_email.
 * created_by is NEVER used.
 */

// ── STRICT NAME DETECTION ─────────────────────────────────────────────────────
// Each pattern must be an explicit self-introduction.
// "I'm Marcus" alone does NOT qualify — it requires a role/context suffix.
// The plain "I'm [Name]" pattern is intentionally absent.
const STRONG_NAME_PATTERNS = [
  // "My name is Marcus" / "My name's Marcus"
  /my name(?:'s|s)?\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  // "I'm Marcus, the bartender" — requires comma + role/context after name
  /i(?:'m| am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,\s*(?:the\s+)?[a-z]+/i,
  // "You can call me Marcus" / "People call me Marcus" / "They call me Marcus"
  /(?:you can call me|people call me|they call me|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  // "Name's Marcus"
  /name(?:'s|s)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
];

// Common state/adjective words that follow "I'm" and are NOT names
const NAME_REJECT_SET = new Set([
  'here', 'sorry', 'not', 'just', 'fine', 'good', 'okay', 'well', 'ready',
  'sure', 'afraid', 'going', 'looking', 'trying', 'busy', 'tired', 'working',
  'back', 'glad', 'happy', 'excited', 'nervous', 'done', 'new', 'open',
  'closed', 'free', 'available', 'around', 'out', 'in', 'up', 'down',
]);

function extractStrictName(text) {
  if (!text) return null;
  for (const pattern of STRONG_NAME_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (!NAME_REJECT_SET.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }
  return null;
}

// Identify venue/background NPCs (not real Character entity records)
function isVenueNpc(npc) {
  return npc?.isNpc === true || npc?.id?.startsWith('npc_');
}

// How many meaningful exchanges before Level 3 (session-known) is reached
// Level 3 alone does NOT trigger persistence — only intent actions do
const LEVEL_3_THRESHOLD = 3;

// How many exchanges before the Level 4 "Save this person?" prompt appears
const LEVEL_4_THRESHOLD = 5;

export function useNPCEvolutionTracker({ messages, selectedNpcs, currentUser, locationName }) {
  // Per-NPC session state — never written to DB automatically
  // Shape: { [npcId]: { name, role, interactionCount, nameDetected, level, promptShown, saved } }
  const [npcState, setNpcState] = useState({});

  // Level 4 promotion prompt state
  const [promotionCandidate, setPromotionCandidate] = useState(null);

  // Duplicate resolution modal state
  const [duplicateResolution, setDuplicateResolution] = useState(null);
  // { mode: 'casualContact' | 'character', npcId, name, role, existingMatches: [] }

  // CasualContact "remember" prompt — shown when user explicitly clicks a memory/contact intent action
  const [casualContactCandidate, setCasualContactCandidate] = useState(null);

  const [isSaving, setIsSaving] = useState(false);
  const [savedConfirmation, setSavedConfirmation] = useState(null);

  // Track which message IDs have been processed to avoid double-counting
  const processedMsgIds = useRef(new Set());
  // Track whether the Level 4 prompt has already been queued for a given npcId
  const promptQueuedRef = useRef(new Set());

  // ── PROCESS INCOMING MESSAGES ─────────────────────────────────────────────
  // Called by the component via useEffect when messages change.
  // Returns updated npcState and any candidate to surface for Level 4.
  const processMessages = useCallback(() => {
    const venueSpeakers = selectedNpcs.filter(isVenueNpc);
    if (venueSpeakers.length === 0) return;

    const newMessages = messages.filter(
      m => m.sender === 'character' && !processedMsgIds.current.has(m.id)
    );
    if (newMessages.length === 0) return;

    setNpcState(prev => {
      const next = { ...prev };

      for (const msg of newMessages) {
        processedMsgIds.current.add(msg.id);

        const speaker = venueSpeakers.find(
          n => n.name === msg.senderName || n.id === msg.characterId
        );
        if (!speaker) continue;

        const existing = next[speaker.id] || {
          name: speaker.name,
          role: speaker.role || null,
          interactionCount: 0,
          nameDetected: false,
          level: 1,
          promptShown: false,
          saved: false,
        };

        // STRICT name detection — weak patterns do NOT advance level
        const detectedName = extractStrictName(msg.content || '');
        const updatedName = detectedName || existing.name;
        const nameDetected = existing.nameDetected || !!detectedName;

        const interactionCount = existing.interactionCount + 1;

        // Level transitions:
        // 1 → 2: only when strict name detected
        // 2 → 3: name confirmed + threshold of exchanges (session-only, no DB write)
        // 3 → 4: higher threshold, ONLY surfaces prompt — no auto-save
        let level = existing.level;
        if (nameDetected && level < 2) level = 2;
        if (nameDetected && interactionCount >= LEVEL_3_THRESHOLD && level < 3) level = 3;
        if (nameDetected && interactionCount >= LEVEL_4_THRESHOLD && level < 4) level = 4;

        next[speaker.id] = {
          ...existing,
          name: updatedName,
          nameDetected,
          interactionCount,
          level,
        };
      }

      return next;
    });
  }, [messages, selectedNpcs]);

  // ── SURFACE LEVEL 4 PROMPT ────────────────────────────────────────────────
  // Called by the component when npcState updates.
  // Only surfaces a prompt if Level 4 is reached and prompt hasn't been shown yet.
  const maybeShowPromotionPrompt = useCallback(() => {
    if (promotionCandidate || duplicateResolution) return; // already showing something

    for (const [npcId, state] of Object.entries(npcState)) {
      if (
        state.level >= 4 &&
        !state.promptShown &&
        !state.saved &&
        !promptQueuedRef.current.has(npcId)
      ) {
        promptQueuedRef.current.add(npcId);
        setNpcState(prev => ({
          ...prev,
          [npcId]: { ...prev[npcId], promptShown: true },
        }));
        setPromotionCandidate({ npcId, name: state.name, role: state.role });
        return;
      }
    }
  }, [npcState, promotionCandidate, duplicateResolution]);

  // ── DISMISS LEVEL 4 PROMPT ────────────────────────────────────────────────
  const dismissPromotionPrompt = useCallback(() => {
    setPromotionCandidate(null);
  }, []);

  // ── INTENT ACTION: REMEMBER / CONTACT INFO ───────────────────────────────
  // Called when user explicitly chooses to persist an NPC as a CasualContact.
  // This is the ONLY path to CasualContact creation — never automatic.
  const handleRememberIntent = useCallback(async (npcId) => {
    if (!currentUser?.email) return;
    const state = npcState[npcId];
    if (!state?.name) return;

    // Duplicate check: search CasualContact + Character by owner_email + name
    try {
      const [existingContacts, existingChars] = await Promise.all([
        base44.entities.CasualContact.filter({ owner_character_id: null, normalized_label: state.name.toLowerCase() }),
        base44.entities.Character.filter({ owner_email: currentUser.email, name: state.name }),
      ]);

      const matches = [
        ...existingContacts.map(c => ({ type: 'CasualContact', id: c.id, label: c.raw_label, context: c.context_note })),
        ...existingChars.map(c => ({ type: 'Character', id: c.id, label: c.name, context: c.occupation || c.character_type })),
      ];

      if (matches.length > 0) {
        // Surface duplicate resolution before any write
        setCasualContactCandidate({ npcId, name: state.name, role: state.role, existingMatches: matches });
      } else {
        // No duplicate — safe to create CasualContact
        await _createCasualContact(state);
      }
    } catch (err) {
      console.error('[useNPCEvolutionTracker] Duplicate check failed:', err);
    }
  }, [npcState, currentUser]);

  // ── RESOLVE CASUALCONTACT DUPLICATE ──────────────────────────────────────
  const resolveCasualContactDuplicate = useCallback(async (choice) => {
    if (!casualContactCandidate) return;
    const state = npcState[casualContactCandidate.npcId];
    if (!state) return;

    if (choice === 'same') {
      // Link context to existing record — no new CasualContact created
      // Update context_note on the first match if it's a CasualContact
      const firstMatch = casualContactCandidate.existingMatches[0];
      if (firstMatch?.type === 'CasualContact') {
        await base44.entities.CasualContact.update(firstMatch.id, {
          context_note: [firstMatch.context, `Also met at ${locationName}`].filter(Boolean).join('; '),
        }).catch(() => {});
      }
    } else if (choice === 'new') {
      await _createCasualContact(state);
    }

    setCasualContactCandidate(null);
  }, [casualContactCandidate, npcState, locationName]);

  // ── LEVEL 4: INITIATE SAVE AS CHARACTER ──────────────────────────────────
  // Duplicate check runs BEFORE any Character write.
  const handleSaveAsCharacter = useCallback(async () => {
    if (!promotionCandidate || !currentUser?.email) return;
    setIsSaving(true);

    try {
      // Duplicate check scoped strictly to owner_email
      const existingChars = await base44.entities.Character.filter({
        owner_email: currentUser.email,
        name: promotionCandidate.name,
      });

      if (existingChars.length > 0) {
        // Surface resolution modal — do NOT create until user decides
        setDuplicateResolution({
          mode: 'character',
          npcId: promotionCandidate.npcId,
          name: promotionCandidate.name,
          role: promotionCandidate.role,
          existingMatches: existingChars.map(c => ({
            id: c.id,
            label: c.name,
            context: c.occupation || c.character_type || '',
          })),
        });
        setPromotionCandidate(null);
      } else {
        // No duplicate — safe to create
        await _createCharacter(promotionCandidate.name, promotionCandidate.role);
        setPromotionCandidate(null);
      }
    } catch (err) {
      console.error('[useNPCEvolutionTracker] Save as character failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [promotionCandidate, currentUser]);

  // ── RESOLVE CHARACTER DUPLICATE ───────────────────────────────────────────
  const resolveCharacterDuplicate = useCallback(async (choice) => {
    if (!duplicateResolution) return;

    if (choice === 'same') {
      // User confirmed this is an existing character — no new record created
      // Optionally update context on the existing character
      const existing = duplicateResolution.existingMatches[0];
      if (existing?.id) {
        await base44.entities.Character.update(existing.id, {
          context_note: `Also encountered at ${locationName}`,
        }).catch(() => {});
      }
      _markSaved(duplicateResolution.npcId);
      setSavedConfirmation(`${duplicateResolution.name} (linked to existing character)`);
    } else if (choice === 'new') {
      // User confirmed this is a genuinely different person
      await _createCharacter(duplicateResolution.name, duplicateResolution.role);
    }

    setDuplicateResolution(null);
    setTimeout(() => setSavedConfirmation(null), 3500);
  }, [duplicateResolution, locationName]);

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────

  async function _createCasualContact(state) {
    await base44.entities.CasualContact.create({
      raw_label: state.name,
      normalized_label: state.name.toLowerCase(),
      context_note: `Met at ${locationName}${state.role ? ` — ${state.role}` : ''}`,
      source_location_id: null, // locationId not threaded here; can be added if needed
    });
    setSavedConfirmation(`${state.name} saved as a contact`);
    setTimeout(() => setSavedConfirmation(null), 3500);
  }

  async function _createCharacter(name, role) {
    await base44.functions.invoke('createNPCCharacter', {
      name,
      role: role || null,
      locationName,
      ownerEmail: currentUser.email,
      characterType: 'npc_fictitious',
      sourceContext: `Met at ${locationName}`,
    });
    _markSaved(promotionCandidate?.npcId || duplicateResolution?.npcId);
    setSavedConfirmation(`${name} saved to your world`);
    setTimeout(() => setSavedConfirmation(null), 3500);
  }

  function _markSaved(npcId) {
    if (!npcId) return;
    setNpcState(prev => ({
      ...prev,
      [npcId]: { ...prev[npcId], saved: true },
    }));
  }

  // ── EXPOSED API ───────────────────────────────────────────────────────────
  return {
    npcState,
    promotionCandidate,
    duplicateResolution,
    casualContactCandidate,
    isSaving,
    savedConfirmation,

    // Called by component on message/npcState changes
    processMessages,
    maybeShowPromotionPrompt,

    // User intent actions
    handleRememberIntent,      // explicit "remember/contact" action for a Level 3 NPC
    resolveCasualContactDuplicate,
    handleSaveAsCharacter,     // user clicks "Save" on Level 4 prompt
    resolveCharacterDuplicate, // user resolves a duplicate character match
    dismissPromotionPrompt,
  };
}