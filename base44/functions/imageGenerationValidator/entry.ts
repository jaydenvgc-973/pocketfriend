/**
 * imageGenerationValidator — Shared pre/post generation visual validation helper.
 *
 * Called by generateImageAsync, regenerateImageWithReason, and mediaGridGenerate.
 *
 * Exposes two operations via mode param:
 *
 *   mode: "prepare"
 *     - Fetches recent conversation context names (live, from DB)
 *     - Resolves location owner/resident names
 *     - Resolves sender name (when sender ≠ subject)
 *     - Calls imageVisualSourceValidator audit
 *     - Returns { boundaryBlock, audit, conversationContextNames, locationOwnerNames }
 *
 *   mode: "validate"
 *     - Calls imageVisualSourceValidator validate
 *     - Returns { passes, reject_reason, issues, vision_result, validation_status }
 *     - On validator error: returns { passes: null, validation_status: "validation_unavailable", error }
 *     - NEVER returns a non-blocking success — caller must handle validation_unavailable explicitly
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    const body = await req.json();
    const { mode } = body;

    if (!mode) {
      return Response.json({ error: 'mode is required (prepare | validate)' }, { status: 400 });
    }

    // ── MODE: PREPARE ─────────────────────────────────────────────────────────
    // Resolve all runtime context, run audit, return boundary block.
    if (mode === 'prepare') {
      const {
        conversationId,       // message.conversation_id — used to fetch recent character names
        senderCharacterId,    // sender's character ID (to resolve sender name for firewall)
        subjectCharacterId,   // approved subject character ID (sender name blocked if ≠ subject)
        locationId,           // character's resolved location ID — for owner/resident name resolution
        approvedSubjects,     // [{ id, name, type, canonical_traits? }]
        sanitizedPrompt,
        expectedHumanCount,
        logPrefix,
      } = body;

      if (!sanitizedPrompt) {
        return Response.json({ error: 'sanitizedPrompt is required for prepare mode' }, { status: 400 });
      }

      // ── 1. Resolve conversation context names from recent messages ──────────
      const conversationContextNames = [];
      let conversationNameResolutionStatus = 'skipped';
      if (conversationId) {
        try {
          const recentMsgs = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: conversationId }, '-created_date', 20
          ).catch(() => []);
          const nameSet = new Set();
          for (const m of recentMsgs) {
            if (m.character_name) nameSet.add(m.character_name);
            if (m.played_as_character_name) nameSet.add(m.played_as_character_name);
          }
          const approvedNameSet = new Set((approvedSubjects || []).map(s => (s.name || '').toLowerCase()));
          for (const n of nameSet) {
            if (n && !approvedNameSet.has(n.toLowerCase())) conversationContextNames.push(n);
          }
          conversationNameResolutionStatus = `resolved_${recentMsgs.length}_msgs_found_${conversationContextNames.length}_context_names`;
          console.log(`${logPrefix || '[imageGenerationValidator]'} conversation_context_names: [${conversationContextNames.join(', ')}] from ${recentMsgs.length} msgs in conv ${conversationId}`);
        } catch (ctxErr) {
          conversationNameResolutionStatus = `error: ${ctxErr?.message}`;
          console.warn(`${logPrefix || '[imageGenerationValidator]'} ctx name resolution failed: ${ctxErr?.message}`);
        }
      }

      // ── 2. Resolve location owner / resident names ──────────────────────────
      const locationOwnerNames = [];
      if (locationId) {
        try {
          const locRecs = await base44.asServiceRole.entities.LocationReference.filter(
            { id: locationId }, null, 1
          ).catch(() => []);
          const loc = locRecs?.[0];
          if (loc) {
            if (loc.owner_character_name) locationOwnerNames.push(loc.owner_character_name);
            if (loc.owner_npc_name) locationOwnerNames.push(loc.owner_npc_name);
            (loc.residents || []).forEach(r => { if (r.character_name) locationOwnerNames.push(r.character_name); });
            (loc.resident_character_names || []).forEach(n => { if (n) locationOwnerNames.push(n); });
          }
        } catch (locErr) {
          console.warn(`${logPrefix || '[imageGenerationValidator]'} location owner resolution failed: ${locErr?.message}`);
        }
      }

      // ── 3. Resolve sender name for firewall ────────────────────────────────
      // If senderCharacterId ≠ subjectCharacterId, the sender is NOT the subject.
      // The sender's name must be in the forbidden list so their identity cannot appear.
      let senderName = null;
      if (senderCharacterId && senderCharacterId !== subjectCharacterId) {
        try {
          const sr = await base44.asServiceRole.entities.Character.filter(
            { id: senderCharacterId }, null, 1
          ).catch(() => []);
          senderName = sr?.[0]?.name || null;
          if (senderName) {
            console.log(`${logPrefix || '[imageGenerationValidator]'} sender_name resolved for firewall: "${senderName}" (id=${senderCharacterId})`);
          }
        } catch (senderErr) {
          console.warn(`${logPrefix || '[imageGenerationValidator]'} sender name resolution failed: ${senderErr?.message}`);
        }
      }

      // ── 4. Run audit ────────────────────────────────────────────────────────
      let audit = null;
      let boundaryBlock = '';
      let auditStatus = 'success';

      try {
        const auditRes = await base44.asServiceRole.functions.invoke('imageVisualSourceValidator', {
          mode: 'audit',
          prompt: sanitizedPrompt,
          approvedSubjects: approvedSubjects || [],
          conversationContextNames,
          locationOwnerNames,
          senderName,
          expectedHumanCount: expectedHumanCount || 1,
          logPrefix: logPrefix || '[imageGenerationValidator][audit]',
        });
        audit = auditRes?.data?.audit || null;
        boundaryBlock = auditRes?.data?.boundary_block || '';
      } catch (auditErr) {
        auditStatus = 'validation_unavailable';
        console.error(`${logPrefix || '[imageGenerationValidator]'} ⛔ audit FAILED: ${auditErr?.message}`);
        audit = {
          validation_status: 'validation_unavailable',
          error: auditErr?.message,
        };
        // Fail-closed fallback boundary block — maximum isolation
        boundaryBlock = '\n\n⚠️ VISUAL SOURCE BOUNDARY: Audit unavailable — proceed with maximum identity isolation. No conversation or location context persons may appear. Only approved subjects may be rendered.\n';
      }

      return Response.json({
        success: true,
        audit,
        boundaryBlock,
        conversationContextNames,
        locationOwnerNames,
        senderName,
        auditStatus,
        conversationNameResolutionStatus,
      });
    }

    // ── MODE: VALIDATE ────────────────────────────────────────────────────────
    // Post-generation vision check. Returns structured result.
    // NEVER returns non-blocking on error — caller must inspect validation_status.
    if (mode === 'validate') {
      const {
        imageUrl,
        audit,
        charRecord,    // { name, appearance_lock } — optional, for appearance drift checks
        expectedHumanCount,
        attempt,
        logPrefix,
      } = body;

      if (!imageUrl) {
        return Response.json({ error: 'imageUrl is required for validate mode' }, { status: 400 });
      }

      try {
        const validateRes = await base44.asServiceRole.functions.invoke('imageVisualSourceValidator', {
          mode: 'validate',
          imageUrl,
          audit: audit || { final_visual_roster: [], conversation_entities_detected: [], location_entities_detected: [], expected_human_count: expectedHumanCount || 1 },
          charRecord: charRecord || null,
          expectedHumanCount: expectedHumanCount || 1,
          attempt: attempt || 1,
          logPrefix: logPrefix || '[imageGenerationValidator][validate]',
        });

        const vd = validateRes?.data || {};

        return Response.json({
          success: true,
          passes: vd.passes ?? null,
          reject_reason: vd.reject_reason || null,
          issues: vd.issues || [],
          vision_result: vd.vision_result || null,
          // validation_status: "passed" | "failed" | "validation_unavailable"
          validation_status: vd.passes === true ? 'passed' : vd.passes === false ? 'failed' : 'validation_unavailable',
          image_not_verified: vd.passes !== true,
        });

      } catch (validateErr) {
        // Validator itself failed — record as validation_unavailable, NOT as passed.
        // The image is unverified. Caller must decide whether to block or flag.
        console.error(`${logPrefix || '[imageGenerationValidator]'} ⛔ validate FAILED: ${validateErr?.message}`);
        return Response.json({
          success: false,
          passes: null,
          reject_reason: null,
          issues: [],
          vision_result: null,
          validation_status: 'validation_unavailable',
          validation_error: validateErr?.message,
          image_not_verified: true,
        });
      }
    }

    return Response.json({ error: `Unknown mode: ${mode}` }, { status: 400 });

  } catch (error) {
    console.error('[imageGenerationValidator] Fatal:', error?.message);
    return Response.json({ success: false, error: error?.message }, { status: 500 });
  }
});