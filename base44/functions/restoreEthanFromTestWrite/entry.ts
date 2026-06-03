/**
 * restoreEthanFromTestWrite
 *
 * ONE-TIME REPAIR: Restores Ethan Thompson's Character record from
 * unauthorized test writes made by the sleep onset diagnostic test.
 *
 * Fields corrupted by test:
 *   - last_sleep_start: '2026-06-03T10:55:41.083Z' → null
 *   - resolved_presence_status: 'sleeping' → 'traveling'
 *   - resolved_location_type: 'home' → null (test overwrite)
 *   - resolved_source_reason: 'diagnostic_sleep_onset_test' → 'travel_session:6a1f40e76e6e8eb43da776a7'
 *
 * After running, this function self-documents as complete and will
 * refuse to run again to prevent accidental re-application.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ETHAN_ID = '69c0d59d7e382cc866ded9c9';
const EXPECTED_CORRUPTED_SLEEP_START = '2026-06-03T10:55:41.083Z';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    // Character RLS on this app enforces owner_email even for service role —
    // use user-scoped reads/writes (requires the calling user to own this character)
    const chars = await base44.entities.Character.filter(
      { id: ETHAN_ID },
      null, 1
    );
    const char = chars[0];
    if (!char) {
      return Response.json({ error: 'Character not found — must be called by the owning user account' }, { status: 404 });
    }

    // Verify the corrupted state matches exactly — refuse to run if already restored
    if (char.last_sleep_start !== EXPECTED_CORRUPTED_SLEEP_START) {
      return Response.json({
        success: false,
        already_restored: true,
        message: 'last_sleep_start does not match the corrupted test value — record may already be restored or was modified by another process.',
        current_last_sleep_start: char.last_sleep_start,
        current_presence_status: char.resolved_presence_status,
      });
    }

    // Restore exactly the fields changed by the test
    await base44.entities.Character.update(ETHAN_ID, {
      last_sleep_start: null,
      resolved_presence_status: 'traveling',
      resolved_source_reason: 'travel_session:6a1f40e76e6e8eb43da776a7',
    });

    // Verify write
    const verify = await base44.entities.Character.filter(
      { id: ETHAN_ID },
      null, 1
    );
    const restored = verify[0];

    return Response.json({
      success: true,
      message: 'Ethan Thompson restored from unauthorized test write',
      restored_fields: {
        last_sleep_start: restored.last_sleep_start,
        resolved_presence_status: restored.resolved_presence_status,
        resolved_source_reason: restored.resolved_source_reason,
      },
    });

  } catch (error) {
    console.error('[restoreEthanFromTestWrite]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});