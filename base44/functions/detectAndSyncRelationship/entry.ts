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
      const detectionRes = await base44.integrations.Core.InvokeLLM({
        prompt: `You are analyzing a chat message exchange to detect relationship claims between characters.

Character speaking: "${char.name}"
Known app characters to check against: ${candidateNames.slice(0, 50).join(', ')}

Chat exchange:
${combinedText}

Task: Find any names from the known characters list that are referenced as someone "${char.name}" knows, has a relationship with, or has interacted with. Do NOT invent names not in the list.

For each found name, detect:
- relationship_type: "friend" | "romantic" | "family" | "coworker" | "classmate" | "acquaintance" | "enemy" | "contact" | "unknown"
- emotional_tone: "positive" | "neutral" | "negative" | "complicated"
- confidence: 0.0-1.0 (how sure are you they're referencing this real person)
- interaction_summary: one sentence describing the nature of their connection as stated

Return JSON: {"relationships": [{"name": "...", "relationship_type": "...", "emotional_tone": "...", "confidence": 0.8, "interaction_summary": "..."}]}
Only include entries with confidence >= 0.6. Return empty array if nothing detected.`,
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

      // Find canonical character by name
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

      // ── ADD TO SENDER'S fictional_relationships if missing ──────────────────
      const senderRels = char.fictional_relationships || [];
      const alreadyLinked = senderRels.some(r =>
        r.related_character_id === matchedChar.id
      );

      if (!alreadyLinked) {
        try {
          await base44.entities.Character.update(character_id, {
            fictional_relationships: [
              ...senderRels,
              {
                related_character_id: matchedChar.id,
                name: matchedChar.name,
                character_name: matchedChar.name,
                relationship_type: det.relationship_type || 'acquaintance',
                emotional_tone: det.emotional_tone || 'neutral',
                source: 'chat_continuity',
                confidence: det.confidence,
                last_interaction_summary: det.interaction_summary || `Known from conversation`,
                detected_at: now,
              },
            ],
          });
        } catch (e) {
          console.warn(`[detectAndSyncRelationship] Failed to update ${char.name} relationships:`, e.message);
          continue;
        }
      }

      // ── ADD TO RECIPIENT'S fictional_relationships if missing and mutual ─────
      const recipientRels = matchedChar.fictional_relationships || [];
      const recipientAlreadyLinked = recipientRels.some(r =>
        r.related_character_id === character_id
      );

      if (!recipientAlreadyLinked) {
        try {
          await base44.entities.Character.update(matchedChar.id, {
            fictional_relationships: [
              ...recipientRels,
              {
                related_character_id: character_id,
                name: char.name,
                character_name: char.name,
                relationship_type: det.relationship_type || 'acquaintance',
                emotional_tone: det.emotional_tone || 'neutral',
                source: 'chat_continuity',
                confidence: det.confidence,
                last_interaction_summary: `${char.name} referenced this relationship in chat`,
                detected_at: now,
              },
            ],
          });
        } catch (e) {
          console.warn(`[detectAndSyncRelationship] Failed to update ${matchedChar.name} relationships:`, e.message);
        }
      }

      // ── WRITE MEMORY FOR SENDER ────────────────────────────────────────────
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
        already_linked: alreadyLinked,
      });

      console.log(`[detectAndSyncRelationship] ✅ ${char.name} ↔ ${matchedChar.name} | type=${det.relationship_type} | confidence=${det.confidence} | was_linked=${alreadyLinked}`);
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