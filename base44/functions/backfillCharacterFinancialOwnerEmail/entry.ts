import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * backfillCharacterFinancialOwnerEmail
 *
 * Repair function with two jobs:
 * 1. Add owner_email to existing CharacterFinancial records that lack it.
 * 2. Create missing CharacterFinancial records for active characters that have none.
 *
 * Source of truth: Character.owner_email + Character.id.
 * Uses asServiceRole to read all characters and financial records across all accounts.
 * Does NOT delete or merge records. Read + patch + create only.
 *
 * Safe to run multiple times.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // Build a map of character_id → owner_email from all Character records first.
    // This requires ONE scan of the Character table rather than N individual lookups,
    // which prevents 429 from per-record queries.
    const allCharacters = await base44.asServiceRole.entities.Character.list(null, 500);
    const characterOwnerMap = new Map(); // character_id → owner_email
    for (const char of allCharacters) {
      if (char.id && char.owner_email) {
        characterOwnerMap.set(char.id, char.owner_email);
      }
    }

    console.log(`[backfillCharacterFinancialOwnerEmail] Loaded ${allCharacters.length} characters, ${characterOwnerMap.size} with owner_email`);

    // Load all CharacterFinancial records
    const allFinancials = await base44.asServiceRole.entities.CharacterFinancial.list('-created_date', 500);

    let patched = 0;
    let alreadyHad = 0;
    let noCharacterFound = 0;
    let errors = 0;
    const report = [];

    for (const fin of allFinancials) {
      if (fin.owner_email) {
        alreadyHad++;
        continue;
      }

      if (!fin.character_id) {
        report.push({ id: fin.id, result: 'no_character_id' });
        noCharacterFound++;
        continue;
      }

      const ownerEmail = characterOwnerMap.get(fin.character_id);
      if (!ownerEmail) {
        // Character was deleted or merged — skip, do not patch orphaned records
        report.push({ id: fin.id, character_id: fin.character_id, character_name: fin.character_name, result: 'character_not_found_or_deleted' });
        noCharacterFound++;
        continue;
      }

      // Patch the financial record with the resolved owner_email
      try {
        await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, {
          owner_email: ownerEmail,
        });

        report.push({ id: fin.id, character_id: fin.character_id, character_name: fin.character_name, owner_email: ownerEmail, result: 'patched' });
        patched++;

        // Pace writes to avoid 429
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        report.push({ id: fin.id, character_id: fin.character_id, result: 'error', error: err.message });
        errors++;
      }
    }

    // ── STEP 2: Create missing CharacterFinancial records ──────────────────────
    // For any active character that has no CharacterFinancial record, create one.
    // This covers characters created before the onCharacterCreated automation was active.
    const existingCharacterIds = new Set(allFinancials.map(f => f.character_id));

    let created = 0;
    let createErrors = 0;
    const createReport = [];

    // CANONICAL RULE: Financial record belongs to the CHARACTER, not to owner_email.
    // Do NOT skip characters that lack owner_email — service-created, NPC, automation-created,
    // and lifecycle-created characters are all valid world citizens and must have financial records.
    // The ONLY exclusion is confirmed deleted/merged status.
    for (const char of allCharacters) {
      if (!char.id || !char.name) continue; // need at minimum an id and name
      if (char.status === 'deleted' || char.status === 'soft_deleted' || char.status === 'merged') continue;
      if (existingCharacterIds.has(char.id)) continue; // already has a record

      try {
        await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: char.id,
          character_name: char.name,
          // owner_email is stored on the financial record when available — used for RLS-scoped reads.
          // When absent (service-created characters), leave null. The record still exists and is valid.
          owner_email: char.owner_email || null,
          is_npc: (char.character_type === 'npc_regular' || char.character_type === 'npc_family_member' || char.character_type === 'npc_fictitious') || false,
          current_balance: 6000,
          total_income: 0,
          total_expenses: 0,
          income_sources: [],
          recurring_expenses: [],
          last_updated: new Date().toISOString(),
        });
        existingCharacterIds.add(char.id); // prevent duplicate if char appears twice
        createReport.push({ character_id: char.id, character_name: char.name, owner_email: char.owner_email || null, result: 'created' });
        created++;
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        createReport.push({ character_id: char.id, character_name: char.name, result: 'create_error', error: err.message });
        createErrors++;
      }
    }

    return Response.json({
      success: true,
      step1_patch_owner_email: {
        total_scanned: allFinancials.length,
        patched,
        already_had_owner_email: alreadyHad,
        no_character_found: noCharacterFound,
        errors,
      },
      step2_create_missing: {
        created,
        errors: createErrors,
        report: createReport,
      },
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});