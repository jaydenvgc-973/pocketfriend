/**
 * processScheduledRelocations
 *
 * Scheduled automation that processes pending relocations.
 * When scheduled_move_time is reached, instantly move character.
 * Replaces processTravelArrivals.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const nowIso = now.toISOString();

    // ── FOREGROUND YIELD CHECK (server-side) ──────────────────────────────────
    // The browser writes key='user_active_session' to AppWorldState when the user is
    // actively using the app. Bulk maintenance automations check this before doing
    // expensive full-table work to avoid competing with foreground user actions.
    // processScheduledRelocations is time-sensitive (Priority 4) — it DOES process
    // user-confirmed movement commitments even during active sessions.
    // It SKIPS the legacy full-table scan (Priority 5) during active sessions.
    let userActiveSessionUntil = 0;
    try {
      const activeFlag = await base44.asServiceRole.entities.AppWorldState.filter(
        { key: 'user_active_session' }, null, 1
      );
      if (activeFlag?.[0]?.value) {
        userActiveSessionUntil = new Date(activeFlag[0].value).getTime();
      }
    } catch { /* non-fatal — proceed without yield check */ }
    const isForegroundActive = now.getTime() < userActiveSessionUntil;
    if (isForegroundActive) {
      console.log(`[processScheduledRelocations] YIELD — user active session until ${new Date(userActiveSessionUntil).toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern. Processing user commitments only.`);
    }

    // ── CHARACTER LOAD: filter to only those with pending relocations ─────────
    // CRITICAL FIX: was .list(null, 1000) — a full table scan every 5 minutes.
    // Changed to filter for characters that actually have pending_scheduled_relocation_at set.
    // This reduces the query from 1000 records to only those with work to do.
    let commitmentChars = [];
    try {
      // Priority 1 chars: have a confirmed pending scheduled relocation
      commitmentChars = await base44.asServiceRole.entities.Character.filter(
        { status: 'active' },
        '-updated_date',
        200
      );
      // Only keep chars that actually have pending relocation data
      commitmentChars = commitmentChars.filter(c =>
        c.owner_email && (
          (c.pending_scheduled_relocation_at && c.next_location_id) ||
          (!isForegroundActive && c.travel_destination_location_id) // legacy only when idle
        )
      );
    } catch (e) {
      console.error('[processScheduledRelocations] Character fetch failed:', e.message);
      return Response.json({ error: e.message }, { status: 500 });
    }

    // During foreground activity, ONLY process user-confirmed commitments (pending_scheduled_relocation_at)
    // not the legacy travel_destination_location_id path (which is maintenance, not time-critical)
    const allChars = isForegroundActive
      ? commitmentChars.filter(c => c.pending_scheduled_relocation_at && c.next_location_id)
      : commitmentChars;

    console.log(`[processScheduledRelocations] Processing ${allChars.length} characters (foreground=${isForegroundActive})`);

    const relocated = [];
    const processed = 0;

    for (const char of allChars) {
      if (!char.owner_email) continue;

      // PRIORITY 1: User-confirmed movement commitment (via chat confirmation)
      if (char.pending_scheduled_relocation_at && char.next_location_id) {
        const scheduledTime = new Date(char.pending_scheduled_relocation_at);
        if (now >= scheduledTime) {
          const fromLocation = char.resolved_current_location_name || 'Home';
          const toLocation = char.next_location_name || 'Destination';

          await base44.asServiceRole.entities.Character.update(char.id, {
            resolved_current_location_id: char.next_location_id,
            resolved_current_location_name: toLocation,
            resolved_presence_status: 'visiting',
            resolved_location_type: 'visit',
            resolved_source_reason: 'scheduled_user_confirmed_relocation',
            resolved_last_updated_at: nowIso,
            // Clear all pending relocation fields
            pending_scheduled_relocation_at: null,
            pending_relocation_from: null,
            pending_relocation_from_name: null,
            pending_relocation_source: null,
            pending_relocation_message_id: null,
            pending_relocation_confirmed_at: null,
            next_location_id: null,
            next_location_name: null,
            travel_status: 'not_traveling',
            travel_destination_location_id: null,
            travel_destination_location_name: null,
            traveling_to_location_id: null,
            traveling_to_location_name: null,
          }).catch(e => console.error(`[processScheduledRelocations] Character update failed for ${char.name}:`, e.message));

          // Mark matching CharacterCommitment records as arrived
          const commitments = await base44.asServiceRole.entities.CharacterCommitment.filter(
            { character_id: char.id, status: 'active', destination_location_id: char.next_location_id },
            null, 5
          ).catch(() => []);
          for (const c of commitments) {
            await base44.asServiceRole.entities.CharacterCommitment.update(c.id, {
              status: 'arrived',
              completed_at: nowIso,
            }).catch(() => {});
          }

          relocated.push({
            character_name: char.name,
            from: fromLocation,
            to: toLocation,
            reason: 'user_confirmed_commitment'
          });
          continue;
        }
      }

      // PRIORITY 2: Legacy travel_destination (fallback)
      if (!char.travel_destination_location_id) continue;

      // Clear stale traveling states — but NEVER overwrite a sleeping/napping character.
      // Sleep is a valid presence state that must not be clobbered by travel cleanup.
      if (char.travel_status === 'traveling' || ['traveling', 'in_transit'].includes(char.resolved_presence_status)) {
        const isSleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';
        if (isSleeping) {
          // Only clear the travel debris fields — do NOT touch resolved_presence_status
          await base44.asServiceRole.entities.Character.update(char.id, {
            travel_status: 'not_traveling',
            travel_destination_location_id: null,
            traveling_to_location_id: null,
            traveling_to_location_name: null,
          }).catch(() => {});
          console.warn(`[processScheduledRelocations] ${char.name} sleeping with stale travel_status — cleared travel debris only, preserved sleep state`);
        } else {
          console.warn(`[processScheduledRelocations] Character ${char.name} still marked as traveling. Clearing stale state.`);
          await base44.asServiceRole.entities.Character.update(char.id, {
            travel_status: 'not_traveling',
            resolved_presence_status: 'home',
            travel_destination_location_id: null,
            traveling_to_location_id: null,
            traveling_to_location_name: null,
          }).catch(() => {});
        }
        continue;
      }

      // Instant relocation at scheduled time
      const result = await base44.asServiceRole.entities.Character.update(char.id, {
        resolved_current_location_id: char.travel_destination_location_id,
        resolved_current_location_name: char.travel_destination_location_name,
        resolved_presence_status: 'at_location',
        resolved_location_type: 'visit',
        resolved_last_updated_at: nowIso,
        arrived_at: nowIso,
        travel_destination_location_id: null,
        travel_destination_location_name: null,
        travel_status: 'not_traveling'
      }).catch(e => ({ error: e.message }));

      if (!result.error) {
        relocated.push({
          character_id: char.id,
          character_name: char.name,
          destination: char.travel_destination_location_name,
          reason: 'legacy_travel_fallback'
        });
      }
    }

    return Response.json({
      success: true,
      processed,
      relocated: relocated.length,
      characters: relocated,
      note: 'Travel system deprecated. Characters instantly relocate at scheduled times.'
    });

  } catch (error) {
    console.error('[processScheduledRelocations]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});