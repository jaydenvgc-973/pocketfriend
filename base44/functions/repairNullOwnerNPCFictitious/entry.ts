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

    // ── STEP 4: Filter to any null-owner contact referenced by this account ──────
    // World Contacts is contact-graph based, not NPC-type based.
    // Any character type (active_created_character, npc_regular, npc_fictitious,
    // npc_family_member, npc_world_service, etc.) may appear in the contact graph
    // with a missing owner_email due to legacy creation paths.
    // We repair ALL such referenced records — not just specific NPC types.
    // Exception: npc_world_service records are globally shared — do not assign
    // them to a single account's owner_email.
    const nullOwnerContacts = candidates.filter(c =>
      !c.owner_email &&
      c.character_type !== 'npc_world_service' &&  // globally shared — never account-assign
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'merged'
    );

    console.log(`[repairNullOwnerNPCFictitious] null_owner_contact_count=${nullOwnerContacts.length} | names=${nullOwnerContacts.map(c => c.name).join(', ')}`);

    if (nullOwnerContacts.length === 0) {
      return Response.json({
        dryRun,
        message: 'No null-owner contact records found that are referenced by this account.',
        repaired: [],
        skipped: [],
        all_candidates_checked: candidates.length,
      });
    }

    // ── STEP 5: Verify each — must be referenced by at least one of this account's chars ──
    const repaired = [];
    const skipped = [];

    for (const contact of nullOwnerContacts) {
      // Find which account character references this contact
      const referencingChar = ownedChars.find(c => {
        const inFictional = (c.fictional_relationships || []).some(r => r.related_character_id === contact.id);
        const inFamily = (c.family_members || []).some(fm =>
          (fm.character_id || fm.related_character_id) === contact.id
        );
        const inPeopleInWorld = (c.people_in_world || c.known_people || []).some(p =>
          (p.related_character_id || p.character_id) === contact.id
        );
        return inFictional || inFamily || inPeopleInWorld;
      });

      if (!referencingChar) {
        skipped.push({
          id: contact.id,
          name: contact.name,
          character_type: contact.character_type,
          reason: 'not_referenced_by_any_owned_character',
        });
        continue;
      }

      const audit = {
        id: contact.id,
        name: contact.name,
        character_type: contact.character_type,
        owner_email_before: contact.owner_email || null,
        owner_user_id_before: contact.owner_user_id || null,
        owner_email_after: ownerEmail,
        owner_user_id_after: userId,
        referenced_by: referencingChar.name,
        referenced_by_id: referencingChar.id,
      };

      if (!dryRun) {
        await base44.asServiceRole.entities.Character.update(contact.id, {
          owner_email: ownerEmail,
          owner_user_id: userId,
        });
        audit.write_status = 'written';
      } else {
        audit.write_status = 'dry_run_only';
      }

      repaired.push(audit);
      console.log(`[repairNullOwnerNPCFictitious] ${dryRun ? 'DRY_RUN' : 'REPAIRED'} | id=${contact.id} | name="${contact.name}" | type=${contact.character_type} | ref_by="${referencingChar.name}"`);
    }

    return Response.json({
      dryRun,
      message: dryRun
        ? `Dry run: ${repaired.length} records would be repaired. Set dryRun=false to apply.`
        : `Repair complete: ${repaired.length} records updated.`,
      repaired,
      skipped,
      total_candidates: candidates.length,
      total_null_owner_contacts: nullOwnerContacts.length,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});