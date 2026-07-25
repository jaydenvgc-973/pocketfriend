/**
 * detectAndSyncRelationship
 *
 * Scans a character's recent chat messages for claims of knowing another app character.
 * When detected, syncs bilateral fictional_relationships + writes memory for both.
 *
 * Triggered after LLM response saves in the chat background pipeline.
 *
 * RULES:
 * - owner_email only — never created_by
 * - Only syncs if both characters exist in the app as canonical Character records
 * - Does NOT create duplicate relationship entries
 * - Does NOT merge or rename characters
 * - Does NOT use name matching alone — must confirm via canonical Character record
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const {
      character_id,           // The character whose chat response we're analyzing
      response_text,          // The character's LLM response text
      user_message_text,      // The user's message that triggered it
      conversation_id,
      owner_email,
      // Optional: co-present character IDs at this location (passed from context builder)
      // These are used to detect incidental encounters vs established relationships.
      co_present_character_ids = [],
      location_name = null,
    } = await req.json();

    if (!character_id || !response_text) {
      return Response.json({ success: false, error: 'Missing character_id or response_text' });
    }

    const ownerEmail = owner_email || user.email;

    // ── LOAD SENDER CHARACTER ─────────────────────────────────────────────────
    const charArr = await base44.entities.Character.filter({ id: character_id }, null, 1).catch(() => []);
    const char = charArr?.[0];
    if (!char) return Response.json({ success: false, error: 'Character not found' });

    // ── LOAD ALL ACCOUNT CHARACTERS (for resolution) ──────────────────────────
    const allChars = await base44.entities.Character.filter({ owner_email: ownerEmail }, null, 200).catch(() => []);
    // Exclude the current character and deleted/merged
    const candidates = allChars.filter(c =>
      c.id !== character_id &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'merged'
    );

    if (candidates.length === 0) {
      return Response.json({ success: true, synced: [], reason: 'no_candidates' });
    }

    // ── USE LLM TO DETECT RELATIONSHIP CLAIMS ────────────────────────────────
    const combinedText = [user_message_text || '', response_text].filter(Boolean).join('\n\n');
    const candidateNames = candidates.map(c => c.name || c.display_name).filter(Boolean);

    let detected = [];
    try {
      // ── DERIVE LISTENER NAME for third-party reference disambiguation ─────
      // conversation_id is provided when called from chat pipeline.
      // Use it to determine who the speaker is talking TO so the LLM can
      // separate listener from the actual subject being discussed.
      let listenerName = null;
      if (conversation_id) {
        try {
          const convoArr = await base44.entities.Conversation.filter({ id: conversation_id }, null, 1).catch(() => []);
          const convo = convoArr[0];
          if (convo) {
            // Conversation types:
            //   direct: type === 'direct' — the user is the listener
            //   phone/world_phone: type === 'phone' or channel === 'world_phone' — other participant
            //   group: type === 'group' — multiple listeners
            //   npc: type === 'npc' — the NPC is the listener
            if (convo.type === 'direct') {
              listenerName = 'the user';
            } else {
              const allChars = await base44.entities.Character.filter({ owner_email: ownerEmail }, null, 200).catch(() => []);
              const otherIds = (convo.character_ids || []).filter(id => id !== character_id);
              const otherChar = allChars.find(c => otherIds.includes(c.id));
              if (otherChar) listenerName = otherChar.name;
            }
          }
        } catch (_) { /* non-blocking */ }
      }
      const listenerContext = listenerName
        ? `\nCRITICAL CONTEXT: The speaker "${char.name}" is talking TO "${listenerName}". "${listenerName}" is the LISTENER, not necessarily the subject of any third-party references.`
        : '';

      const detectionRes = await base44.integrations.Core.InvokeLLM({
        prompt: `You are analyzing a chat message exchange to detect relationship claims between the speaker and OTHER characters.${listenerContext}

SPEAKER (the character talking): "${char.name}"
LISTENER (who the speaker is talking TO): ${listenerName || 'unknown — could be the user or another character'}

Known app characters to check against (these are the ONLY names you may return): ${candidateNames.slice(0, 50).join(', ')}

Chat exchange:
${combinedText}

═══════════════════════════════════════
HARD RULES — VIOLATION = INCORRECT OUTPUT
═══════════════════════════════════════

RULE 1 — LISTENER ≠ SUBJECT:
If the speaker mentions a relationship type (cousin, girlfriend, brother, boss, therapist, partner, etc.) about a THIRD PARTY, do NOT attach that relationship type to the LISTENER.

RIGHT: "My cousin is in town" → the cousin is a third party (NOT the listener). The listener is NOT the cousin.
RIGHT: "I talked to my therapist" → the therapist is a third party (NOT the listener).
RIGHT: "You are my cousin" → the listener IS the cousin. confidence=0.9+ relationship_type=family.
RIGHT: "Hayden is my cousin" → Hayden (a known character) IS the cousin. confidence=0.9+ relationship_type=family.
WRONG: "I haven't talked to my cousin" → DO NOT label the listener as family.

RULE 2 — ONLY EXPLICIT IDENTIFICATION:
Only assign a relationship type when the speaker EXPLICITLY identifies the named character AS that relationship:
- "You are my girlfriend" → the listener IS romantic
- "Hayden is my boss" → Hayden IS the boss
- "My girlfriend Sarah..." → Sarah IS the girlfriend
- "I talked to my brother" → the brother is an UNRESOLVED third party. DO NOT assign to the listener.

RULE 3 — UNRESOLVED THIRD-PARTY REFERENCES:
If the speaker mentions a relationship to someone who is NOT explicitly named AND NOT clearly the listener:
- Set relationship_type to "unknown"
- Set interaction_depth to "incidental" or "none"
- Set confidence <= 0.3
- Do NOT attach to the listener

RULE 4 — WHEN IN DOUBT, DON'T:
If you cannot tell whether the relationship applies to the listener or a third party:
- Set relationship_type to "unknown"
- Set interaction_depth to "incidental"
- Set confidence <= 0.3

═══════════════════════════════════════

For each found name, detect:
- relationship_type: "friend" | "romantic" | "family" | "coworker" | "classmate" | "acquaintance" | "enemy" | "contact" | "unknown"
- emotional_tone: "positive" | "neutral" | "negative" | "complicated"
- confidence: 0.0-1.0 (how sure are you they're referencing this real person)
- interaction_summary: one sentence describing the nature of their connection as stated
- interaction_depth: "established" | "introduced" | "incidental" | "none"
  - "established": they clearly already know each other well
  - "introduced": they are meeting or introducing themselves for the first time
  - "incidental": a brief mention, passing reference, or one-off observation (saw them, bumped into them)
  - "none": just co-location with no actual exchange

Return JSON: {"relationships": [{"name": "...", "relationship_type": "...", "emotional_tone": "...", "confidence": 0.8, "interaction_summary": "...", "interaction_depth": "..."}]}
Only include entries with confidence >= 0.6. If no confident matches, return empty array.`,
        response_json_schema: {
          type: 'object',
          properties: {
            relationships: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  relationship_type: { type: 'string' },
                  emotional_tone: { type: 'string' },
                  confidence: { type: 'number' },
                  interaction_summary: { type: 'string' },
                  interaction_depth: { type: 'string' },
                },
              },
            },
          },
        },
      });
      detected = detectionRes?.relationships || [];
    } catch (e) {
      console.warn('[detectAndSyncRelationship] LLM detection failed:', e.message);
      return Response.json({ success: true, synced: [], reason: 'llm_detection_failed' });
    }

    if (detected.length === 0) {
      return Response.json({ success: true, synced: [], reason: 'none_detected' });
    }

    const synced = [];
    const now = new Date().toISOString();

    for (const det of detected) {
      if (!det.name || det.confidence < 0.6) continue;

      // Find canonical character by name (ID preferred; name is display fallback)
      const nameLower = det.name.toLowerCase().trim();
      const matchedChar = candidates.find(c =>
        c.name?.toLowerCase() === nameLower ||
        c.display_name?.toLowerCase() === nameLower ||
        c.primary_name?.toLowerCase() === nameLower ||
        c.name?.toLowerCase().includes(nameLower) ||
        nameLower.includes(c.name?.toLowerCase() || '')
      );

      if (!matchedChar) {
        console.log(`[detectAndSyncRelationship] "${det.name}" not matched to any canonical character — skipping`);
        continue;
      }

      // ── BOUNDARY CHECK — Test Character Safety Addendum ──────────────────
      // Use the existing authoritative classification (is_test_character) on
      // both participants. If one is a disposable test character and the other
      // is an actual (non-test) character, skip ALL prospective writes for
      // this pair (fictional_relationships, transient_encounters,
      // CharacterMemory). Only this pair's writes are skipped; the loop
      // continues to process other detected relationships. This is an inline
      // condition within the existing write-owning function — not a new
      // helper, guard, or abstraction.
      const _senderIsTest = char.is_test_character === true;
      const _matchedIsTest = matchedChar.is_test_character === true;
      if (_senderIsTest !== _matchedIsTest) {
        console.warn(`[detectAndSyncRelationship] BLOCKED test-to-real write: ${char.name} (test=${_senderIsTest}) ↔ ${matchedChar.name} (test=${_matchedIsTest})`);
        continue;
      }

      const depth = det.interaction_depth || 'established';

      // ── RULE: co-location alone ("none") writes nothing ────────────────────
      if (depth === 'none') {
        console.log(`[detectAndSyncRelationship] "${matchedChar.name}" — depth=none (co-location only), writing nothing`);
        continue;
      }

      // ── RULE: incidental encounter → transient_encounters (Chance Encounters) ─
      // Does NOT promote to fictional_relationships.
      // Bilateral: write on both characters.
      if (depth === 'incidental') {
        const encounterEntry = {
          related_character_id: matchedChar.id,
          description: det.interaction_summary || `Brief encounter with ${matchedChar.name}`,
          context: location_name || 'unknown location',
          emotional_reaction: det.emotional_tone || 'neutral',
          encountered_at: now,
          source: 'chat_detected',
        };

        // Write to sender if not already in transient_encounters for this character
        const senderEncounters = char.transient_encounters || [];
        const senderAlreadyEncountered = senderEncounters.some(e => e.related_character_id === matchedChar.id);
        if (!senderAlreadyEncountered) {
          try {
            await base44.entities.Character.update(character_id, {
              transient_encounters: [...senderEncounters, encounterEntry],
            });
            console.log(`[detectAndSyncRelationship] 📍 transient_encounter: ${char.name} → ${matchedChar.name}`);
          } catch (e) {
            console.warn(`[detectAndSyncRelationship] transient_encounters write failed (sender):`, e.message);
          }
        }

        // Write bilateral: recipient side
        const recipientEncounters = matchedChar.transient_encounters || [];
        const recipientAlreadyEncountered = recipientEncounters.some(e => e.related_character_id === character_id);
        if (!recipientAlreadyEncountered) {
          try {
            await base44.entities.Character.update(matchedChar.id, {
              transient_encounters: [
                ...recipientEncounters,
                {
                  related_character_id: character_id,
                  description: `Brief encounter with ${char.name}`,
                  context: location_name || 'unknown location',
                  emotional_reaction: 'neutral',
                  encountered_at: now,
                  source: 'chat_detected_bilateral',
                },
              ],
            });
          } catch (e) {
            console.warn(`[detectAndSyncRelationship] transient_encounters write failed (recipient):`, e.message);
          }
        }

        synced.push({
          character_a: char.name,
          character_b: matchedChar.name,
          character_b_id: matchedChar.id,
          write_type: 'transient_encounter',
          depth,
        });
        console.log(`[detectAndSyncRelationship] ✅ incidental encounter: ${char.name} ↔ ${matchedChar.name}`);
        continue; // Do not fall through to fictional_relationships
      }

      // ── RULE: introduced or established → fictional_relationships ────────────
      // SAFE MERGE: re-fetch immediately before write to prevent stale-overwrite data loss.
      // Another write (ensureBilateralCharacterAwareness, AddPeopleInTheirWorldPanel, etc.)
      // may have happened between the top-of-function fetch and this point.
      // Never overwrite existing relationships with a stale array.
      const freshSenderArr = await base44.entities.Character.filter({ id: character_id }, null, 1).catch(() => []);
      const freshSender = freshSenderArr[0];
      if (!freshSender) {
        console.warn(`[detectAndSyncRelationship] Fresh re-fetch of ${character_id} failed — skipping write`);
        continue;
      }
      const senderRels = freshSender.fictional_relationships || [];
      const alreadyLinked = senderRels.some(r => r.related_character_id === matchedChar.id);

      if (!alreadyLinked) {
        try {
          await base44.entities.Character.update(character_id, {
            fictional_relationships: [
              ...senderRels,
              {
                person_name: matchedChar.name,
                related_character_id: matchedChar.id,
                relationship_type: det.relationship_type || 'acquaintance',
                emotional_tone: det.emotional_tone || 'neutral',
                description: det.interaction_summary || '',
                last_interaction_summary: det.interaction_summary || `Met via ${depth}`,
                source: 'chat_continuity',
                confidence: det.confidence,
                detected_at: now,
              },
            ],
          });
        } catch (e) {
          console.warn(`[detectAndSyncRelationship] Failed to update ${freshSender.name} fictional_relationships:`, e.message);
          continue;
        }
      }

      // Bilateral: re-fetch recipient immediately before write
      const freshRecipientArr = await base44.entities.Character.filter({ id: matchedChar.id }, null, 1).catch(() => []);
      const freshRecipient = freshRecipientArr[0];
      const recipientRels = freshRecipient?.fictional_relationships || matchedChar.fictional_relationships || [];
      const recipientAlreadyLinked = recipientRels.some(r => r.related_character_id === character_id);

      if (!recipientAlreadyLinked && freshRecipient) {
        try {
          await base44.entities.Character.update(matchedChar.id, {
            fictional_relationships: [
              ...recipientRels,
              {
                person_name: freshSender.name,
                related_character_id: character_id,
                relationship_type: det.relationship_type || 'acquaintance',
                emotional_tone: det.emotional_tone || 'neutral',
                description: `${freshSender.name} — met via chat`,
                last_interaction_summary: `${freshSender.name} referenced this connection in conversation`,
                source: 'chat_continuity_bilateral',
                confidence: det.confidence,
                detected_at: now,
              },
            ],
          });
        } catch (e) {
          console.warn(`[detectAndSyncRelationship] Failed to update ${matchedChar.name} fictional_relationships (bilateral):`, e.message);
        }
      }

      // Write memory for sender (established/introduced only — not incidental)
      try {
        await base44.entities.CharacterMemory.create({
          character_id,
          memory_type: 'relationship',
          memory_text: `I know ${matchedChar.name}. ${det.interaction_summary || ''}`,
          memory_summary: `Relationship with ${matchedChar.name}: ${det.relationship_type || 'acquaintance'}`,
          related_character_id: matchedChar.id,
          importance_score: det.relationship_type === 'romantic' || det.relationship_type === 'family' ? 8 : 5,
          confidence_score: det.confidence,
          permanence: 'long_term',
          validation_status: 'confirmed',
        });
      } catch (e) {
        console.warn(`[detectAndSyncRelationship] Sender memory write failed:`, e.message);
      }

      synced.push({
        character_a: char.name,
        character_b: matchedChar.name,
        character_b_id: matchedChar.id,
        relationship_type: det.relationship_type,
        emotional_tone: det.emotional_tone,
        confidence: det.confidence,
        write_type: 'fictional_relationships',
        depth,
        already_linked: alreadyLinked,
      });

      console.log(`[detectAndSyncRelationship] ✅ ${char.name} ↔ ${matchedChar.name} | type=${det.relationship_type} | depth=${depth} | confidence=${det.confidence} | was_linked=${alreadyLinked}`);
    }

    return Response.json({
      success: true,
      synced,
      total_detected: detected.length,
      total_synced: synced.length,
    });

  } catch (error) {
    console.error('[detectAndSyncRelationship]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});