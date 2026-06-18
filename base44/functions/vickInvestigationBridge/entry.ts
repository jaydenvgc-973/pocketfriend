import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * vickInvestigationBridge
 *
 * Wires Vick's investigative path into his actual conversation.
 * Called from the frontend when the user asks Vick to investigate.
 *
 * Runs diagnostics, formats evidence-labeled findings, and writes them
 * as a Vick-character message into the conversation.
 *
 * PARAMETERS:
 *   conversation_id (required) — Vick's direct conversation ID
 *   scope (optional) — "account_overview" | "character_snapshot:<charId>" | "scoped_investigation:<charId>"
 *
 * FINDINGS ARE LABELED:
 *   OBSERVED   — directly queried from database records
 *   INFERRED   — derived from patterns, not directly confirmed
 *   ASSUMED    — educated guess, not confirmed
 *   UNKNOWN    — could not determine
 *
 * PRIVACY: Vick is not made omniscient. Sensitive content is summarized.
 * Raw private message content is never dumped.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({}));
    const conversationId = payload.conversationId || payload.conversation_id;
    let scope = payload.scope || payload.investigationScope || 'account_overview';
    const dryRun = payload.dryRun || payload.dry_run || false;

    if (!conversationId && !dryRun) {
      return Response.json({ error: 'conversation_id is required' }, { status: 400 });
    }

    const ownerEmail = user.email;
    const nowIso = new Date().toISOString();
    const nowET = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
    });

    // ── STEP 1: Find Vick via safe multi-path lookup ────────────────────────
    let vick = null;

    // Path 1: is_world_service flag (most reliable, type-independent)
    try {
      const r = await base44.asServiceRole.entities.Character.filter(
        { is_world_service: true, owner_email: ownerEmail, status: 'active' },
        '-created_date', 5
      ).catch(() => []);
      if (r.length > 0) vick = r[0];
    } catch (_) {}

    // Path 2: name match (works regardless of type)
    if (!vick) {
      try {
        const r = await base44.asServiceRole.entities.Character.filter(
          { name: 'Vick Servicio', owner_email: ownerEmail, status: 'active' },
          '-created_date', 5
        ).catch(() => []);
        if (r.length > 0) vick = r[0];
      } catch (_) {}
    }

    // Path 3: character_type (legacy fallback only)
    if (!vick) {
      try {
        const r = await base44.asServiceRole.entities.Character.filter(
          { character_type: 'npc_world_service', owner_email: ownerEmail, status: 'active' },
          '-created_date', 5
        ).catch(() => []);
        if (r.length > 0) vick = r[0];
      } catch (_) {}
    }

    if (!vick) {
      return Response.json({ error: 'Vick not found for this account' }, { status: 404 });
    }

    // ── STEP 2: Verify conversation belongs to this account ─────────────────
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      { id: conversationId, owner_email: ownerEmail }, null, 1
    ).catch(() => []);
    if (!convos[0]) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // ── STEP 3: Parse scope ────────────────────────────────────────────────
    let diagnosticType = scope;
    let characterId = null;
    if (scope.startsWith('character_snapshot:')) {
      diagnosticType = 'character_snapshot';
      characterId = scope.slice('character_snapshot:'.length);
    } else if (scope.startsWith('scoped_investigation:')) {
      diagnosticType = 'scoped_investigation';
      characterId = scope.slice('scoped_investigation:'.length);
    }

    // ── STEP 4: Run diagnostics and collect evidence ────────────────────────
    const observed = [];
    const inferred = [];
    const assumed = [];
    const unknown = [];

    // ═══ CHARACTER SNAPSHOT ════════════════════════════════════════════════
    if (diagnosticType === 'character_snapshot' && characterId) {
      try {
        const char = (await base44.entities.Character.filter({ id: characterId }))[0] || null;
        if (!char) {
          unknown.push(`Character ${characterId} not found in database`);
        } else {
          const name = char.name || characterId;
          observed.push(`—— Character State: ${name} ——`);
          observed.push(`Location: ${char.resolved_presence_status} at ${char.resolved_current_location_name || 'unknown'} (${char.resolved_source_reason || 'no reason'})`);
          observed.push(`Energy: ${char.energy_value}, Health: ${char.health_value}, Hunger: ${char.hunger_value}`);
          observed.push(`Sleep window: ${char.sleep_start_time || 'unset'} → ${char.wake_up_time || 'unset'}`);
          observed.push(`Work: ${char.work_start_time || 'none'} → ${char.work_end_time || 'none'} days ${(char.work_days || []).join(',') || 'none'}`);
          observed.push(`Student: ${char.student_status || 'not_student'}`);
          observed.push(`Character type: ${char.character_type || 'not set'}, world_service: ${char.is_world_service || false}`);

          // Contradiction detection
          const presence = char.resolved_presence_status;
          if (presence === 'sleeping' || presence === 'napping') {
            if (char.work_start_time && char.work_end_time) {
              inferred.push(`Sleep window active but char has work schedule — may be off-day or outside shift`);
            }
          }
          if (char.energy_value < 20) {
            inferred.push(`Energy critically low (${char.energy_value}) — may be exhausted`);
          }
        }
      } catch (e) {
        unknown.push(`Character snapshot failed: ${e.message}`);
      }
    }

    // ═══ SCOPED INVESTIGATION ══════════════════════════════════════════════
    if (diagnosticType === 'scoped_investigation' && characterId) {
      try {
        const char = (await base44.entities.Character.filter({ id: characterId }))[0] || null;
        const name = char?.name || characterId;
        observed.push(`—— Scoped Investigation: ${name} ——`);

        // Conversations
        const allConvos = await base44.asServiceRole.entities.Conversation.list(null, 200).catch(() => []);
        const charConvos = allConvos.filter(c =>
          Array.isArray(c.character_ids) && c.character_ids.includes(characterId)
        );
        observed.push(`Conversations: ${charConvos.length}`);
        if (charConvos.length > 0) {
          charConvos.slice(0, 3).forEach(c => {
            observed.push(`  • ${c.title || 'Untitled'} (${c.channel || c.type})`);
          });
        }

        // Messages (count only, content summarized)
        let msgCount = 0;
        for (const c of charConvos.slice(0, 3)) {
          const msgs = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: c.id }, '-timestamp', 5
          ).catch(() => []);
          msgCount += msgs.length;
        }
        observed.push(`Recent messages (top conversations): ${msgCount}`);

        // Relationships
        const rels = await base44.asServiceRole.entities.CharacterRelationship.filter(
          { source_character_id: characterId }, null, 20
        ).catch(() => []);
        observed.push(`Relationships: ${rels.length}`);
        if (rels.length > 0) {
          rels.slice(0, 3).forEach(r => {
            observed.push(`  • ${r.relationship_type}: ${r.label_from_source_perspective || r.target_character_id} (friendship:${r.friendship_level} trust:${r.trust_level})`);
          });
        }

        // Memories
        const mems = await base44.asServiceRole.entities.CharacterMemory.filter(
          { character_id: characterId }, null, 10
        ).catch(() => []);
        observed.push(`Character memories: ${mems.length}`);
        if (mems.length > 0) {
          mems.slice(0, 5).forEach(m => {
            observed.push(`  • [${m.memory_type}] ${(m.memory_summary || m.memory_text || '').slice(0, 80)}`);
          });
        }

        // Story events
        const allEvents = await base44.asServiceRole.entities.StoryEvent.list(null, 100).catch(() => []);
        const charEvents = allEvents.filter(e =>
          Array.isArray(e.participant_character_ids) && e.participant_character_ids.includes(characterId)
        );
        observed.push(`Story events: ${charEvents.length}`);
        if (charEvents.length > 0) {
          charEvents.slice(0, 3).forEach(e => {
            observed.push(`  • ${e.title} (${e.event_date}) status:${e.status}`);
          });
        }

      } catch (e) {
        unknown.push(`Scoped investigation failed: ${e.message}`);
      }
    }

    // ═══ ACCOUNT OVERVIEW ══════════════════════════════════════════════════
    if (diagnosticType === 'account_overview') {
      try {
        observed.push('—— Account Overview ——');

        const chars = await base44.entities.Character.filter(
          { owner_email: ownerEmail, status: 'active' }, null, 100
        ).catch(() => []);
        observed.push(`Active characters: ${chars.length}`);

        const locs = await base44.entities.LocationReference.filter(
          { owner_email: ownerEmail }, null, 100
        ).catch(() => []);
        observed.push(`Locations: ${locs.length}`);

        // Active travel
        const travel = await base44.asServiceRole.entities.TravelSession.filter(
          { owner_email: ownerEmail, route_status: 'in_transit' }, null, 20
        ).catch(() => []);
        if (travel.length > 0) {
          observed.push(`Active travel sessions: ${travel.length}`);
          const stuck = travel.filter(s => {
            if (!s.estimated_arrival_time) return false;
            return new Date(s.estimated_arrival_time).getTime() < Date.now() - 30 * 60 * 1000;
          });
          if (stuck.length > 0) {
            const stuckList = stuck.map(s => {
              const etaET = new Date(s.estimated_arrival_time).toLocaleString('en-US', {
                timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
              });
              return `${s.character_name} → ${s.destination_location_name} (ETA ${etaET} Eastern)`;
            });
            inferred.push(`${stuck.length} stuck travel session(s): ${stuckList.join(', ')}`);
          }
        } else {
          observed.push('No active travel sessions');
        }

        // Vick self-report
        observed.push(`Vick Servicio: ID ${vick.id}, type: ${vick.character_type || 'not set'}, world_service: ${vick.is_world_service || false}`);
        observed.push(`Vick location: ${vick.resolved_presence_status} at ${vick.resolved_current_location_name || 'unknown'}`);

      } catch (e) {
        unknown.push(`Account overview failed: ${e.message}`);
      }
    }

    // ── STEP 5: Build evidence-labeled findings text ───────────────────────
    const lines = [];
    lines.push('═══ RECOVERY YARD FINDINGS ═══');
    lines.push(`Generated: ${nowET} Eastern`);
    lines.push(`Scope: ${scope}`);
    lines.push('');

    if (observed.length > 0) {
      lines.push('—— OBSERVED (directly verified from database records) ——');
      observed.forEach(o => lines.push(`  ${o}`));
      lines.push('');
    }
    if (inferred.length > 0) {
      lines.push('—— INFERRED (derived from patterns, not directly confirmed) ——');
      inferred.forEach(i => lines.push(`  ${i}`));
      lines.push('');
    }
    if (assumed.length > 0) {
      lines.push('—— ASSUMED (educated guess, not confirmed) ——');
      assumed.forEach(a => lines.push(`  ${a}`));
      lines.push('');
    }
    if (unknown.length > 0) {
      lines.push('—— UNKNOWN (could not determine) ——');
      unknown.forEach(u => lines.push(`  ${u}`));
      lines.push('');
    }

    lines.push('Review complete. Ask if you need more detail on any finding.');

    const findingsText = lines.join('\n');

    // ── STEP 6: Write findings as Vick message (skip if dryRun) ────────────
    if (!dryRun && conversationId) {
      await base44.asServiceRole.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: vick.id,
        character_name: vick.name || 'Vick Servicio',
        content: findingsText,
        recovery_signal: false,
        memory_eligible: true,
        relationship_eligible: true,
        is_read: false,
        timestamp: nowIso,
      }).catch(err => {
        console.error(`[vickInvestigationBridge] Message save failed: ${err.message}`);
      });

      // Update conversation metadata
      await base44.asServiceRole.entities.Conversation.update(conversationId, {
        last_message_preview: `Recovery Yard findings ready (${scope})`,
        last_message_date: nowIso,
      }).catch(() => {});
    }

    console.log(`[vickInvestigationBridge] ${dryRun ? 'Returned' : 'Delivered'} findings ${dryRun ? '' : `to conversation ${conversationId}`} for ${ownerEmail}`);

    return Response.json({
      success: true,
      ownerEmail,
      vickId: vick.id,
      conversationId,
      scope,
      dryRun,
      findingsText,
      observedCount: observed.length,
      inferredCount: inferred.length,
      assumedCount: assumed.length,
      unknownCount: unknown.length,
    });

  } catch (error) {
    console.error('[vickInvestigationBridge]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});