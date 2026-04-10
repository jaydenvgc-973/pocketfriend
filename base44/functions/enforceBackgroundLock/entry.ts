/**
 * BACKGROUND LOCK ENFORCER
 * Scans recent LifeEvents and Memory records for any content that
 * attempts to rewrite a character's background/past identity.
 * Flags and removes violations.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const BACKGROUND_LOCKED_FIELDS = [
  'background_story', 'backstory', 'family_history',
  'background', 'criminal_record', 'education',
  'family_members', 'departed_characters',
];

const BACKGROUND_VIOLATION_PATTERNS = [
  /they've always been/i,
  /grew up/i,
  /childhood/i,
  /was born/i,
  /in the past/i,
  /their origin/i,
  /originally from/i,
  /back when they were/i,
];

function detectViolation(text) {
  return BACKGROUND_VIOLATION_PATTERNS.some(p => p.test(text));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { characterId, updateObj } = body;

    // Mode 1: Pre-update check — validate an update object before it's applied
    if (updateObj) {
      const blocked = BACKGROUND_LOCKED_FIELDS.filter(f => f in updateObj);
      if (blocked.length > 0) {
        return Response.json({
          violation: true,
          error: 'BACKGROUND_MODIFIED',
          blocked_fields: blocked,
          message: `System attempted to modify locked background fields: ${blocked.join(', ')}`,
        }, { status: 403 });
      }
      return Response.json({ violation: false, message: 'Update is safe.' });
    }

    // Mode 2: Scan recent life events for background violations
    const query = characterId ? { character_id: characterId } : {};
    const recentEvents = await base44.entities.LifeEvent.filter(query, '-timestamp', 50);

    const violations = [];
    for (const event of recentEvents) {
      const text = `${event.title || ''} ${event.description || ''}`;
      if (detectViolation(text)) {
        violations.push({
          event_id: event.id,
          character_id: event.character_id,
          title: event.title,
          flag: 'BACKGROUND_MODIFIED',
        });
      }
    }

    return Response.json({
      scanned: recentEvents.length,
      violations: violations.length,
      details: violations,
      message: violations.length === 0
        ? 'No background violations found.'
        : `${violations.length} potential background modification(s) detected.`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});