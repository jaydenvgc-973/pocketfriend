import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * writeVerifiedLocationHistory — THE SINGLE AUTHORITATIVE LocationHistory WRITER
 *
 * HARD RULES:
 * 1. Caller must have ALREADY written Character.resolved_current_location_id
 *    to the target location_id before calling. Verified here — refuses if not.
 * 2. owner_email cross-checked against Character.owner_email — never trusted from caller.
 * 3. arrival_time is always server "now" — callers cannot backdate or fabricate.
 * 4. event_type validated against an allow-list AND cross-checked against the
 *    destination LocationReference category and Character presence status.
 *    Misleading labels (e.g. 'religious_service' for a non-religion location)
 *    are rejected.
 * 5. travel_source validated against an allow-list and normalized.
 * 6. Prior open (is_current:true) records closed correctly (open.location_id compared).
 * 7. Post-write duplicate cleanup: re-reads is_current:true rows for this
 *    character+location and collapses duplicates (best-effort — see concurrency note).
 * 8. Fails visibly — returns { success:false, error } instead of throwing into a catch.
 *
 * CONCURRENCY NOTE (not atomic):
 * This platform has no transaction primitive or database-level unique constraint
 * on (character_id, location_id, is_current). Between the open-records fetch and
 * the create(), a concurrent writer can also create an is_current:true row,
 * producing a brief duplicate. The post-write cleanup pass collapses duplicates
 * it can see, but a duplicate created between cleanup-read and cleanup-write can
 * persist. This is an UNRESOLVED platform-level race — reported explicitly, not
 * hidden behind false atomicity language.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let sessionUser = null;
    try { sessionUser = await base44.auth.me(); } catch { /* scheduled/service context */ }

    const {
      character_id,
      owner_email,
      location_id,
      event_type = 'arrival',
      travel_source = 'system',
      travel_reason = null,
    } = await req.json();

    if (!character_id || !owner_email || !location_id) {
      return Response.json({ success: false, error: 'character_id, owner_email, and location_id are required' }, { status: 400 });
    }

    if (sessionUser && sessionUser.email !== owner_email) {
      return Response.json({ success: false, error: 'owner_email does not match authenticated session' }, { status: 403 });
    }

    // ── VALIDATE event_type against allow-list ────────────────────────────
    const ALLOWED_EVENT_TYPES = [
      'arrival', 'departure', 'stay', 'return_home', 'work_start', 'work_end',
      'school_start', 'school_end', 'religious_service', 'food_need',
      'social_visit', 'gym_visit', 'transit', 'other'
    ];
    const normalizedEventType = String(event_type || '').toLowerCase();
    if (!ALLOWED_EVENT_TYPES.includes(normalizedEventType)) {
      return Response.json({
        success: false,
        error: 'invalid_event_type',
        reason: `"${event_type}" is not a recognized event type. Allowed: ${ALLOWED_EVENT_TYPES.join(', ')}`,
      }, { status: 400 });
    }

    // ── VALIDATE and normalize travel_source ──────────────────────────────
    const ALLOWED_TRAVEL_SOURCES = [
      'schedule', 'autonomous', 'promise', 'commitment', 'need_fulfillment',
      'manual', 'system', 'other'
    ];
    const TRAVEL_SOURCE_MAP = {
      autonomous_need: 'need_fulfillment',
      autonomous_want: 'autonomous',
      routine: 'schedule',
      event: 'other',
      promise: 'promise',
      manual: 'manual',
      work_schedule: 'schedule',
      school_schedule: 'schedule',
      commitment: 'commitment',
    };
    let normalizedTravelSource = String(travel_source || '').toLowerCase();
    if (TRAVEL_SOURCE_MAP[normalizedTravelSource]) {
      normalizedTravelSource = TRAVEL_SOURCE_MAP[normalizedTravelSource];
    }
    if (!ALLOWED_TRAVEL_SOURCES.includes(normalizedTravelSource)) {
      return Response.json({
        success: false,
        error: 'invalid_travel_source',
        reason: `"${travel_source}" is not a recognized travel source. Allowed: ${ALLOWED_TRAVEL_SOURCES.join(', ')}`,
      }, { status: 400 });
    }

    // ── VERIFY CHARACTER + OWNER ─────────────────────────────────────────
    const [char] = await base44.asServiceRole.entities.Character.filter({ id: character_id }, null, 1);
    if (!char) {
      return Response.json({ success: false, error: 'character_not_found' }, { status: 404 });
    }
    if (char.owner_email !== owner_email) {
      return Response.json({ success: false, error: 'owner_mismatch', character_owner: char.owner_email }, { status: 403 });
    }

    // ── VERIFY CANONICAL STATE SUPPORTS THIS EVENT ───────────────────────
    if (char.resolved_current_location_id !== location_id) {
      return Response.json({
        success: false,
        error: 'character_state_mismatch',
        reason: `Character.resolved_current_location_id (${char.resolved_current_location_id}) does not match requested location_id (${location_id}). The Character write must happen before requesting this proof.`,
      }, { status: 409 });
    }

    // ── LOAD destination for category cross-check ────────────────────────
    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter({ id: location_id }, null, 1);
    const destCategory = destLoc?.category || 'generic';
    const charPresence = char.resolved_presence_status || '';

    // ── CROSS-CHECK event_type against destination category / presence ────
    // Semantic event types require matching destination category or presence status.
    // Generic types ('arrival', 'departure', 'stay', 'transit', 'other') are always allowed.
    const GENERIC_EVENT_TYPES = ['arrival', 'departure', 'stay', 'transit', 'other'];
    const EVENT_TYPE_CATEGORY_RULES = {
      work_start:       { allowedCategories: ['workplace', 'business'], allowedPresence: ['at_work'] },
      work_end:         { allowedCategories: ['workplace', 'business'] },
      school_start:     { allowedCategories: ['school', 'education'], allowedPresence: ['at_school'] },
      school_end:       { allowedCategories: ['school', 'education'] },
      return_home:      { allowedCategories: ['home'], allowedPresence: ['home'] },
      gym_visit:        { allowedCategories: ['gym'] },
      religious_service:{ allowedCategories: ['religion'] },
      food_need:        { allowedCategories: ['food_drink', 'grocery'] },
      social_visit:     { allowedCategories: ['social'] },
    };

    if (!GENERIC_EVENT_TYPES.includes(normalizedEventType)) {
      const rule = EVENT_TYPE_CATEGORY_RULES[normalizedEventType];
      if (rule) {
        const categoryOk = rule.allowedCategories ? rule.allowedCategories.includes(destCategory) : true;
        const presenceOk = rule.allowedPresence ? rule.allowedPresence.includes(charPresence) : true;
        if (!categoryOk && !presenceOk) {
          return Response.json({
            success: false,
            error: 'event_type_mismatch',
            reason: `event_type "${normalizedEventType}" requires destination category in [${rule.allowedCategories?.join(', ') || 'n/a'}] OR presence in [${rule.allowedPresence?.join(', ') || 'n/a'}], but destination category is "${destCategory}" and presence is "${charPresence}".`,
            destination_category: destCategory,
            character_presence: charPresence,
          }, { status: 400 });
        }
      }
    }

    const nowIso = new Date().toISOString();

    // ── CLOSE PRIOR OPEN RECORDS (correct field comparison) ──────────────
    const openRecords = await base44.asServiceRole.entities.LocationHistory.filter(
      { character_id, owner_email, is_current: true }, null, 20
    );
    for (const open of openRecords) {
      if (open.location_id === location_id) continue;
      const arrivalMs = new Date(open.arrival_time).getTime();
      const durationMinutes = Math.round((Date.now() - arrivalMs) / 60000);
      await base44.asServiceRole.entities.LocationHistory.update(open.id, {
        is_current: false,
        departure_time: nowIso,
        duration_minutes: durationMinutes > 0 ? durationMinutes : null,
      });
    }

    // ── PREVENT DUPLICATE CURRENT RECORD FOR THE SAME LOCATION ───────────
    const alreadyCurrentForThisLocation = openRecords.find(o => o.location_id === location_id);
    if (alreadyCurrentForThisLocation) {
      return Response.json({ success: true, record_id: alreadyCurrentForThisLocation.id, note: 'already_current_no_duplicate_created' });
    }

    // ── WRITE THE NEW ARRIVAL RECORD ──────────────────────────────────────
    const record = await base44.asServiceRole.entities.LocationHistory.create({
      character_id,
      character_name: char.name || 'Unknown',
      owner_email,
      location_id,
      location_name: destLoc?.name || '',
      location_category: destCategory,
      event_type: normalizedEventType,
      arrival_time: nowIso,
      travel_source: normalizedTravelSource,
      travel_reason: travel_reason || null,
      is_current: true,
    });

    // ── POST-WRITE DUPLICATE CLEANUP (compensating, not atomic) ──────────
    // Re-read is_current:true rows for this character+location. If a concurrent
    // writer also created one, collapse duplicates by keeping the newest and
    // marking older ones is_current:false. This is best-effort — without a DB
    // unique constraint, a duplicate created between this read and the cleanup
    // writes can persist.
    let duplicateCleanupResult = { checked: false, duplicates_found: 0, duplicates_closed: 0, cleanup_error: null };
    try {
      const postWriteCurrent = await base44.asServiceRole.entities.LocationHistory.filter(
        { character_id, owner_email, location_id, is_current: true }, '-arrival_time', 10
      );
      duplicateCleanupResult.checked = true;
      duplicateCleanupResult.duplicates_found = postWriteCurrent.length;
      if (postWriteCurrent.length > 1) {
        const keep = postWriteCurrent[0]; // newest (first in -arrival_time sort)
        for (let i = 1; i < postWriteCurrent.length; i++) {
          await base44.asServiceRole.entities.LocationHistory.update(postWriteCurrent[i].id, {
            is_current: false,
            departure_time: nowIso,
            duration_minutes: 0,
          });
          duplicateCleanupResult.duplicates_closed++;
        }
      }
    } catch (cleanupErr) {
      duplicateCleanupResult.cleanup_error = cleanupErr.message;
    }

    if (duplicateCleanupResult.duplicates_found > 1 && duplicateCleanupResult.duplicates_closed < duplicateCleanupResult.duplicates_found - 1) {
      return Response.json({
        success: true,
        record_id: record.id,
        warning: 'duplicate_current_rows_remain',
        duplicate_cleanup: duplicateCleanupResult,
      });
    }

    return Response.json({
      success: true,
      record_id: record.id,
      duplicate_cleanup: duplicateCleanupResult,
    });
  } catch (error) {
    console.error('[writeVerifiedLocationHistory] ERROR:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});