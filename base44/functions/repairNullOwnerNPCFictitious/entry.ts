/**
 * repairNullOwnerNPCFictitious
 *
 * Identifies npc_fictitious Character records with null/missing owner_email
 * that are linked to this account via the owner's characters'
 * fictional_relationships or family_members arrays.
 *
 * Step 1: Identify the 3 null-owner npc_fictitious records by name.
 * Step 2: Verify they are referenced by at least one active_created_character
 *         that belongs to this account.
 * Step 3: Backfill owner_email (and owner_user_id) ONLY on verified records.
 * Step 4: Never change character_type. Never promote to active_created_character.
 * Step 5: Return full audit trail including names before and after.
 *
 * Dry-run mode (default): set dryRun=false in payload to actually write.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default: dry run

    const ownerEmail = user.email;
    const userId = user.id;

    // ── STEP 1: Load all characters owned by this account ─────────────────────
    const ownedChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail },
      null, 500
    );

    // ── STEP 2: Collect all related_character_id references from owned chars ───
    // Sources: fictional_relationships, family_members
    const referencedIds = new Set();
    for (const c of ownedChars) {
      for (const rel of (c.fictional_relationships || [])) {
        if (rel.related_character_id) referencedIds.add(rel.related_character_id);
      }
      for (const fm of (c.family_members || [])) {
        const id = fm.character_id || fm.related_character_id;
        if (id) referencedIds.add(id);
      }
    }

    console.log(`[repairNullOwnerNPCFictitious] account=${ownerEmail} | owned_chars=${ownedChars.length} | referenced_ids=${referencedIds.size}`);

    if (referencedIds.size === 0) {
      return Response.json({
        dryRun,
        message: 'No referenced character IDs found in fictional_relationships or family_members.',
        repaired: [],
        skipped: [],
      });
    }

    // ── STEP 3: Fetch those referenced characters via service role ─────────────
    // Service role bypasses RLS so we can find null-owner records.
    const candidateResults = await Promise.all(
      [...referencedIds].map(id =>
        base44.asServiceRole.entities.Character.filter({ id }).catch(() => [])
      )
    );
    const candidates = candidateResults.flat();

    // ── STEP 4: Filter to null-owner npc_fictitious (or npc_family_member) ─────
    const nullOwnerNPCs = candidates.filter(c =>
      !c.owner_email &&
      (c.character_type === 'npc_fictitious' || c.character_type === 'npc_family_member') &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted'
    );

    console.log(`[repairNullOwnerNPCFictitious] null_owner_npc_count=${nullOwnerNPCs.length} | names=${nullOwnerNPCs.map(c => c.name).join(', ')}`);

    if (nullOwnerNPCs.length === 0) {
      return Response.json({
        dryRun,
        message: 'No null-owner npc_fictitious or npc_family_member records found that are referenced by this account.',
        repaired: [],
        skipped: [],
        all_candidates_checked: candidates.length,
      });
    }

    // ── STEP 5: Verify each — must be referenced by at least one of this account's chars ──
    const repaired = [];
    const skipped = [];

    for (const npc of nullOwnerNPCs) {
      // Find which account character references this NPC
      const referencingChar = ownedChars.find(c => {
        const inFictional = (c.fictional_relationships || []).some(r => r.related_character_id === npc.id);
        const inFamily = (c.family_members || []).some(fm =>
          (fm.character_id || fm.related_character_id) === npc.id
        );
        return inFictional || inFamily;
      });

      if (!referencingChar) {
        skipped.push({
          id: npc.id,
          name: npc.name,
          character_type: npc.character_type,
          reason: 'not_referenced_by_any_owned_character',
        });
        continue;
      }

      const audit = {
        id: npc.id,
        name: npc.name,
        character_type: npc.character_type,
        owner_email_before: npc.owner_email || null,
        owner_user_id_before: npc.owner_user_id || null,
        owner_email_after: ownerEmail,
        owner_user_id_after: userId,
        referenced_by: referencingChar.name,
        referenced_by_id: referencingChar.id,
      };

      if (!dryRun) {
        await base44.asServiceRole.entities.Character.update(npc.id, {
          owner_email: ownerEmail,
          owner_user_id: userId,
        });
        audit.write_status = 'written';
      } else {
        audit.write_status = 'dry_run_only';
      }

      repaired.push(audit);
      console.log(`[repairNullOwnerNPCFictitious] ${dryRun ? 'DRY_RUN' : 'REPAIRED'} | id=${npc.id} | name="${npc.name}" | type=${npc.character_type} | ref_by="${referencingChar.name}"`);
    }

    return Response.json({
      dryRun,
      message: dryRun
        ? `Dry run: ${repaired.length} records would be repaired. Set dryRun=false to apply.`
        : `Repair complete: ${repaired.length} records updated.`,
      repaired,
      skipped,
      total_candidates: candidates.length,
      total_null_owner_npcs: nullOwnerNPCs.length,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});