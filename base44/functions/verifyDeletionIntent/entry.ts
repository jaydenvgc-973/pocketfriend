import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * verifyDeletionIntent
 *
 * GAP FIX G2: Deletion intent verification.
 *
 * Reads CharacterDeletionAudit records to determine whether a character
 * was intentionally deleted by the user or lost through system error.
 *
 * This makes intent verification available during Recovery Yard candidate
 * evaluation, so intentionally deleted characters are not flagged as
 * recovery candidates.
 *
 * Returns:
 *   - intentionally_deleted: the character was soft-deleted via deleteCharacter
 *   - no_deletion_record: no audit record exists (may be unintended loss)
 *   - not_found: no matching deletion record or character record
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterIds } = await req.json().catch(() => ({}));
    if (!characterIds || !Array.isArray(characterIds) || characterIds.length === 0) {
      return Response.json({ error: 'characterIds (array) required' }, { status: 400 });
    }

    const results = [];

    for (const characterId of characterIds) {
      // ── Check CharacterDeletionAudit for intentional deletion ────────────────
      const audits = await base44.asServiceRole.entities.CharacterDeletionAudit.filter(
        { character_id: characterId },
        '-created_date',
        10
      ).catch(() => []);

      if (audits.length > 0) {
        // Intentional deletion confirmed — user chose to delete this character
        const mostRecent = audits[0];
        results.push({
          character_id: characterId,
          verdict: 'intentionally_deleted',
          deletion_type: mostRecent.deletion_type,
          deletion_date: mostRecent.created_date,
          audit_record_id: mostRecent.id,
          recovery_eligible: false,
          reason: 'User explicitly deleted this character through deleteCharacter. Do not restore.',
        });
        continue;
      }

      // ── No deletion audit: check if character exists with soft_deleted status ──
      const characters = await base44.asServiceRole.entities.Character.filter(
        { id: characterId },
        null,
        1
      ).catch(() => []);

      if (characters.length === 0) {
        results.push({
          character_id: characterId,
          verdict: 'not_found',
          recovery_eligible: false,
          reason: 'Character record not found. Cannot determine deletion intent.',
        });
        continue;
      }

      const char = characters[0];
      if (char.status === 'soft_deleted' || char.status === 'deleted') {
        // Character is deleted but no audit record — may be unintended system loss
        results.push({
          character_id: characterId,
          verdict: 'possibly_unintended_loss',
          status: char.status,
          character_name: char.name || 'Unknown',
          recovery_eligible: true,
          reason: 'Character has deleted status but no CharacterDeletionAudit record. Possibly unintended system loss. Review recommended.',
        });
        continue;
      }

      // Character exists and is not deleted
      results.push({
        character_id: characterId,
        verdict: 'active',
        status: char.status || 'unknown',
        character_name: char.name || 'Unknown',
        recovery_eligible: false,
        reason: 'Character is active — no recovery needed.',
      });
    }

    return Response.json({
      success: true,
      ownerEmail: user.email,
      results,
      summary: {
        intentionally_deleted: results.filter(r => r.verdict === 'intentionally_deleted').length,
        possibly_unintended_loss: results.filter(r => r.verdict === 'possibly_unintended_loss').length,
        active: results.filter(r => r.verdict === 'active').length,
        not_found: results.filter(r => r.verdict === 'not_found').length,
      },
    });

  } catch (error) {
    console.error('[verifyDeletionIntent]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});