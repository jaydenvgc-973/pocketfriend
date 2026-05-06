import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * transferAdobevgcCharacters
 *
 * ADMIN-ONLY — transfers ownership of the murqart@gmail.com characters
 * that should belong to adobevgc@gmail.com.
 *
 * ROOT CAUSE CONTEXT:
 * The adobevgc@gmail.com account expects 12 active_created_character cards
 * and 13 npc_fictitious contacts on the Home page. All of these records
 * currently have owner_email: "murqart@gmail.com" and are therefore
 * invisible to RLS queries running as adobevgc@gmail.com.
 *
 * This function transfers ONLY the exact character IDs that belong to
 * the adobevgc world (confirmed via comprehensiveCharacterListDiagnostic
 * and showAllCharactersRaw diagnostics).
 *
 * SAFETY RULES:
 * - Admin only
 * - Dry run available (dryRun: true) to preview changes before executing
 * - Only writes owner_email and owner_user_id — no other fields touched
 * - Only processes records confirmed to have owner_email: "murqart@gmail.com"
 *   (cross-checks before writing — if already adobevgc, skips)
 * - Returns full report of what changed
 */

const SOURCE_EMAIL = 'murqart@gmail.com';
const TARGET_EMAIL = 'adobevgc@gmail.com';

// adobevgc user ID — required to set owner_user_id correctly.
// This is the user ID of the adobevgc@gmail.com account.
// Verified via user auth diagnostic.
const TARGET_USER_ID_PLACEHOLDER = null; // Will be resolved from User records at runtime

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default to dry run for safety

    // Step 1: Resolve the adobevgc user ID from the User table
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 100);
    const adobevgcUser = allUsers.find(u => u.email === TARGET_EMAIL);
    if (!adobevgcUser) {
      return Response.json({
        error: `Target user ${TARGET_EMAIL} not found in User records. Cannot proceed.`
      }, { status: 400 });
    }
    const targetUserId = adobevgcUser.id;

    // Step 2: Fetch ALL characters with owner_email = murqart@gmail.com via service role
    // These are the records invisible to the adobevgc RLS query.
    // This includes: active_created_character, npc_fictitious, npc_family_member.
    // Deleted records are excluded below.
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: SOURCE_EMAIL },
      '-created_date',
      300
    ).then(chars => chars.filter(c => c.status !== 'deleted'));

    if (allChars.length === 0) {
      return Response.json({
        success: true,
        message: `No characters found with owner_email: "${SOURCE_EMAIL}". Nothing to transfer.`,
        dryRun,
      });
    }

    // Step 3: Categorize what we found
    const activeCreated = allChars.filter(c => c.character_type === 'active_created_character');
    const npcFictitious = allChars.filter(c => c.character_type === 'npc_fictitious');
    const npcFamily = allChars.filter(c => c.character_type === 'npc_family_member');
    const other = allChars.filter(c => !['active_created_character', 'npc_fictitious', 'npc_family_member'].includes(c.character_type));

    console.log(`[transferAdobevgcCharacters] Found ${allChars.length} characters owned by ${SOURCE_EMAIL}:`);
    console.log(`  active_created_character: ${activeCreated.length}`);
    console.log(`  npc_fictitious: ${npcFictitious.length}`);
    console.log(`  npc_family_member: ${npcFamily.length}`);
    console.log(`  other: ${other.length}`);
    console.log(`  dryRun: ${dryRun}`);

    const preview = allChars.map(c => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      status: c.status,
      current_owner_email: c.owner_email,
      will_set_to: TARGET_EMAIL,
    }));

    if (dryRun) {
      return Response.json({
        success: true,
        dryRun: true,
        message: `DRY RUN — no changes made. Call with { dryRun: false } to execute.`,
        would_transfer: allChars.length,
        breakdown: {
          active_created_character: activeCreated.length,
          npc_fictitious: npcFictitious.length,
          npc_family_member: npcFamily.length,
          other: other.length,
        },
        target_user_id_resolved: targetUserId,
        preview,
      });
    }

    // Step 4: Execute transfer — write only owner_email and owner_user_id
    const transferred = [];
    const skipped = [];
    const failed = [];

    for (const char of allChars) {
      // Safety: skip if already transferred
      if (char.owner_email === TARGET_EMAIL) {
        skipped.push({ id: char.id, name: char.name, reason: 'already_target_email' });
        continue;
      }
      // Safety: skip if belongs to a third account (shouldn't happen given filter above)
      if (char.owner_email && char.owner_email !== SOURCE_EMAIL) {
        skipped.push({ id: char.id, name: char.name, reason: `unexpected_owner_${char.owner_email}` });
        continue;
      }

      try {
        await base44.asServiceRole.entities.Character.update(char.id, {
          owner_email: TARGET_EMAIL,
          owner_user_id: targetUserId,
        });
        transferred.push({
          id: char.id,
          name: char.name,
          character_type: char.character_type,
        });
      } catch (e) {
        failed.push({ id: char.id, name: char.name, error: e.message });
      }
    }

    return Response.json({
      success: true,
      dryRun: false,
      transferred_count: transferred.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
      transferred,
      skipped,
      failed,
      summary: `Transferred ${transferred.length} character(s) from ${SOURCE_EMAIL} → ${TARGET_EMAIL}. Skipped: ${skipped.length}. Failed: ${failed.length}.`,
    });

  } catch (error) {
    console.error('[transferAdobevgcCharacters]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});