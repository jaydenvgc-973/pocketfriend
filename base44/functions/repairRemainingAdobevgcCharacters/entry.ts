import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * repairRemainingAdobevgcCharacters
 *
 * ADMIN-ONLY — Second-pass repair for characters that should belong to
 * adobevgc@gmail.com but were not caught by the first transfer pass.
 *
 * These specific character IDs were confirmed via discoverActiveCreatedCharacters
 * and comprehensiveCharacterListDiagnostic to belong to the adobevgc world
 * but their owner_email still resolves as murqart@gmail.com at the RLS layer
 * (meaning the service-role filter by owner_email: murqart finds 0 but the
 * user-scoped RLS query as murqart still finds them — a platform-layer
 * field indexing issue where data.owner_email differs from the stored value).
 *
 * FIX: Use exact IDs, fetch via service role by ID, write owner_email + owner_user_id.
 */

const TARGET_EMAIL = 'adobevgc@gmail.com';
const TARGET_USER_ID = '69dc11160b6a8c4e19937fac'; // adobevgc user ID confirmed via prior diagnostic

// Exact IDs confirmed via discoverActiveCreatedCharacters + comprehensiveCharacterListDiagnostic
// All active_created_character records belonging to the adobevgc world
const ACTIVE_CHARACTER_IDS = [
  '69cef8406d65304465075d79', // Melody Jackson Perry
  '69cd1c421ecd8b69850b3a6a', // Andre Rivera
  '69cb6a64a823aa902e589f99', // Brian Anderson
  '69c7b299fe07fcd80eedfdfd', // Lila Green
  '69c7b299fe07fcd80eedfdfc', // Nathan Parker
  '69c215677279ef7b0b01a737', // James Anderson
  '69c0d59d7e382cc866ded9c9', // Ethan Thompson
  '69c0c0e2945e5649ef6e72f8', // Ava Dei Park
  '69c05643cad0c019b157815c', // Jonathan Anthony Smith
  '69c01e985ccb5ecb47d2972e', // Matt Lopez
  '69f026b893b57c9e7b19f705', // Shiloh Devon
];

// npc_fictitious IDs that should belong to adobevgc
// (from comprehensiveCharacterListDiagnostic: Rick Taylor, Demi Rivers, Jordan Li, Leah Park, Mia Chen, Carlos Mendez, Mace + others)
const NPC_FICTITIOUS_IDS = [
  '69e3f96fd9761e3f08fcd4f9', // Rick Taylor
  '69d35c6ea52b980efec03f3b', // Demi Rivers
  '69d35c6edfae8b3db537a8de', // Jordan Li
  '69d35c6d96377c7834fcd810', // Leah Park
  '69d35c6da13201824e860f52', // Mia Chen
  '69d35c6c4263aa71b21205f3', // Carlos Mendez
  '69d35c6c16b6e6785f29b91a', // Mace
];

// npc_family_member IDs (test + any not caught in first transfer)
const NPC_FAMILY_IDS = [
  '69eeb222e4b48cfe2453fb93', // Test Family Member
];

const ALL_TARGET_IDS = [...ACTIVE_CHARACTER_IDS, ...NPC_FICTITIOUS_IDS, ...NPC_FAMILY_IDS];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default dry run

    const results = [];
    const skipped = [];
    const failed = [];

    for (const charId of ALL_TARGET_IDS) {
      // Fetch via service role to see the record regardless of current owner_email
      let record;
      try {
        const records = await base44.asServiceRole.entities.Character.filter(
          { id: charId }, null, 1
        );
        record = records?.[0] || null;
      } catch (e) {
        failed.push({ id: charId, error: `fetch_failed: ${e.message}` });
        continue;
      }

      if (!record) {
        // Try list fallback
        try {
          const all = await base44.asServiceRole.entities.Character.list('-created_date', 500);
          record = all.find(c => c.id === charId) || null;
        } catch (e2) {
          failed.push({ id: charId, error: `list_fallback_failed: ${e2.message}` });
          continue;
        }
      }

      if (!record) {
        skipped.push({ id: charId, reason: 'not_found_in_db' });
        continue;
      }

      // Skip if already correctly owned
      if (record.owner_email === TARGET_EMAIL) {
        skipped.push({ id: charId, name: record.name, reason: 'already_correct_owner_email' });
        continue;
      }

      const currentOwner = record.owner_email || '(null)';

      if (dryRun) {
        results.push({
          id: charId,
          name: record.name,
          character_type: record.character_type,
          current_owner_email: currentOwner,
          will_set_to: TARGET_EMAIL,
        });
        continue;
      }

      // Execute write
      try {
        await base44.asServiceRole.entities.Character.update(charId, {
          owner_email: TARGET_EMAIL,
          owner_user_id: TARGET_USER_ID,
        });
        results.push({
          id: charId,
          name: record.name,
          character_type: record.character_type,
          from: currentOwner,
          to: TARGET_EMAIL,
        });
        console.log(`[repairRemainingAdobevgcCharacters] Repaired ${record.name} (${charId}): ${currentOwner} → ${TARGET_EMAIL}`);
      } catch (e) {
        failed.push({ id: charId, name: record.name, error: e.message });
      }
    }

    return Response.json({
      success: true,
      dryRun,
      message: dryRun
        ? 'DRY RUN — call with { dryRun: false } to execute'
        : `Repaired ${results.length} character(s). Skipped: ${skipped.length}. Failed: ${failed.length}.`,
      repaired_count: results.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
      results,
      skipped,
      failed,
    });

  } catch (error) {
    console.error('[repairRemainingAdobevgcCharacters]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});