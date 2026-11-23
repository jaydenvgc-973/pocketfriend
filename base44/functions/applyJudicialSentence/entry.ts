/**
 * applyJudicialSentence
 *
 * Records a confirmed judicial outcome on the character it actually applies to.
 * It creates no parallel judicial system:
 *   • the conviction/sentence is written into the character's existing criminal history
 *   • custody uses the existing incarceration fields and the facility's existing inmate roster
 *   • release, sentence completion, visitation and inmate restrictions keep running through
 *     the established pathways (releaseCharacterFromJail, processDueCharacterDeletions, etc.)
 *
 * Called only after the user has explicitly confirmed the defendant, the outcome and,
 * where imprisonment applies, the facility and duration.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const CONVICTION_OUTCOMES = ['incarceration', 'custody', 'probation', 'fine', 'community_service', 'suspended'];

function easternDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function easternDateOnly(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function sentenceDays(value, unit) {
  if (unit === 'life') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'months') return Math.round(n * 30);
  if (unit === 'years') return Math.round(n * 365);
  return Math.round(n);
}

function sentenceText(value, unit, days) {
  if (unit === 'life') return 'Life imprisonment';
  const n = Number(value);
  const label = n === 1 ? unit.replace(/s$/, '') : unit;
  return `${n} ${label}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const characterId = body.character_id;
    const outcome = String(body.outcome || '');
    const offense = String(body.offense || '').trim();
    const notes = String(body.notes || '').trim();
    const facilityId = body.facility_id || null;
    const courtName = String(body.court_name || 'the court').trim();
    const caseType = String(body.case_type || 'criminal');

    if (!characterId) return Response.json({ error: 'A defendant must be selected' }, { status: 400 });
    if (!CONVICTION_OUTCOMES.includes(outcome) && !['acquittal', 'dismissal'].includes(outcome)) {
      return Response.json({ error: 'Unknown judicial outcome' }, { status: 400 });
    }
    if (['acquittal', 'dismissal'].includes(outcome)) {
      return Response.json({ error: 'An acquittal or dismissal is not a conviction and is never recorded as one' }, { status: 400 });
    }
    if (!offense) return Response.json({ error: 'The offence or conviction is required' }, { status: 400 });

    const custody = outcome === 'incarceration' || outcome === 'custody';
    const days = custody ? sentenceDays(body.sentence_value, body.sentence_unit) : null;
    if (custody && body.sentence_unit !== 'life' && !days) {
      return Response.json({ error: 'A sentence duration is required for custody' }, { status: 400 });
    }
    if (custody && !facilityId) {
      return Response.json({ error: 'A correctional facility must be selected' }, { status: 400 });
    }

    // The character must be one this account actually owns.
    const owned = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email }, null, 500);
    const character = (owned || []).find((c) => c.id === characterId);
    if (!character) return Response.json({ error: 'Character not found on this account' }, { status: 403 });
    if (['deleted', 'soft_deleted', 'merged'].includes(character.status)) {
      return Response.json({ error: 'That character is no longer active' }, { status: 400 });
    }
    if (character.life_status === 'deceased' || character.status === 'deceased') {
      return Response.json({ error: 'A deceased character cannot be sentenced' }, { status: 400 });
    }

    // The facility is read with the caller's own access: a facility they cannot reach
    // is not one they can send anyone to.
    let facility = null;
    if (custody) {
      facility = await base44.entities.LocationReference.get(facilityId)
        .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!facility) return Response.json({ error: 'That correctional facility is not available to you' }, { status: 403 });
      if (!(facility.category === 'jail_prison' || facility.is_confinement_facility === true)) {
        return Response.json({ error: 'The selected location is not a correctional facility' }, { status: 400 });
      }
    }

    const now = new Date();
    const nowISO = now.toISOString();
    const durationLabel = custody ? sentenceText(body.sentence_value, body.sentence_unit, days) : null;
    const outcomeLabel = {
      probation: 'Sentenced to probation',
      fine: 'Fined',
      community_service: 'Sentenced to community service',
      suspended: 'Sentence suspended',
    }[outcome] || 'Sentenced';

    const historyLine = custody
      ? `${easternDate(now)} — ${outcome === 'custody' ? 'Held in contempt' : 'Convicted'}${offense ? ` of ${offense}` : ''} at ${courtName}. Sentenced to ${durationLabel}${facility ? ` at ${facility.name}` : ''}.`
      : `${easternDate(now)} — Convicted of ${offense} at ${courtName}. ${outcomeLabel}.`;

    const existingRecord = String(character.criminal_record || '').trim();
    const hasRecord = existingRecord && existingRecord.toLowerCase() !== 'none';
    const criminalRecord = `${hasRecord ? `${existingRecord}\n` : ''}${historyLine}`;

    const releaseISO = custody && days ? new Date(now.getTime() + days * 86400000).toISOString() : null;

    const characterUpdate = { criminal_record: criminalRecord };

    if (custody && facility) {
      Object.assign(characterUpdate, {
        is_jailed: true,
        incarceration_facility_id: facility.id,
        incarceration_facility_name: facility.name,
        incarceration_status: outcome === 'custody' ? 'held' : (caseType === 'sentencing' ? 'sentenced' : 'sentenced'),
        jail_sentence_days: days,
        jail_release_date: releaseISO,
        jailed_at: nowISO,
        pending_charges: offense ? [offense] : (character.pending_charges || []),
        resolved_current_location_id: facility.id,
        resolved_current_location_name: facility.name,
        resolved_location_type: 'incarcerated',
        resolved_presence_status: 'incarcerated',
        resolved_source_reason: 'judicial_sentence',
        resolved_last_updated_at: nowISO,
        presence_stay_lock: false,
      });
    }

    await base44.asServiceRole.entities.Character.update(character.id, characterUpdate);

    // The facility's own inmate roster is the same record the Places panel maintains.
    let inmateRecord = null;
    if (custody && facility) {
      const inmates = Array.isArray(facility.inmates) ? [...facility.inmates] : [];
      const idx = inmates.findIndex((i) => i?.character_id === character.id);
      inmateRecord = {
        character_id: character.id,
        character_name: character.name,
        charges: offense,
        booking_date: easternDateOnly(now),
        confinement_status: outcome === 'custody' ? 'held' : 'sentenced',
        sentence_days: days || undefined,
        expected_release_date: releaseISO ? easternDateOnly(new Date(releaseISO)) : undefined,
        confined_at: nowISO,
        notes: notes || `Sentenced at ${courtName}`,
      };
      if (idx >= 0) inmates[idx] = { ...inmates[idx], ...inmateRecord }; else inmates.push(inmateRecord);
      await base44.asServiceRole.entities.LocationReference.update(facility.id, { inmates });
    }

    await base44.asServiceRole.entities.LifeEvent.create({
      character_id: character.id,
      character_name: character.name,
      event_type: 'legal_or_social_consequence_event',
      valence: 'negative',
      severity: custody ? 'major' : 'moderate',
      title: custody ? `Sentenced: ${durationLabel}` : outcomeLabel,
      description: historyLine,
      emotional_impact: custody ? 'The reality of confinement setting in' : 'The weight of a legal outcome',
      triggered_by: 'user_confirmed_sentencing',
      timestamp: nowISO,
      context_tags: ['court', 'sentencing', 'user_confirmed', outcome],
    }).catch(() => {});

    return Response.json({
      success: true,
      character_id: character.id,
      character_name: character.name,
      outcome,
      criminal_record: criminalRecord,
      incarceration: custody && facility ? {
        facility_id: facility.id,
        facility_name: facility.name,
        sentence_days: days,
        sentence_label: durationLabel,
        release_date: releaseISO,
        inmate: inmateRecord,
      } : null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});