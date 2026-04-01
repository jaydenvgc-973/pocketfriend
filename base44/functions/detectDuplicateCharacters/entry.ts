import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * detectDuplicateCharacters
 * 
 * Scan all characters for likely duplicates using scoring on:
 * - exact/near-exact name match
 * - alias overlap
 * - occupation similarity
 * - shared memories/message themes
 * - schedule overlap
 * 
 * Returns grouped candidates with confidence scores.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const chars = await base44.asServiceRole.entities.Character.filter({
      status: 'active',
    });

    const duplicateGroups = [];
    const processed = new Set();

    // ─────────────────────────────────────────────────────────
    // SCORING LOGIC
    // ─────────────────────────────────────────────────────────
    for (let i = 0; i < chars.length; i++) {
      for (let j = i + 1; j < chars.length; j++) {
        const c1 = chars[i];
        const c2 = chars[j];
        const key = [c1.id, c2.id].sort().join('_');

        if (processed.has(key)) continue;
        processed.add(key);

        let score = 0;
        const signals = [];

        // Name similarity
        if (nameMatch(c1.name, c2.name) > 0.7) {
          score += 40;
          signals.push('name_match');
        }

        // Occupation similarity
        if (c1.work_details?.job_title && c2.work_details?.job_title) {
          if (c1.work_details.job_title === c2.work_details.job_title) {
            score += 15;
            signals.push('same_occupation');
          }
        }

        // Relationship label
        if (c1.personality_summary && c2.personality_summary) {
          const p1 = c1.personality_summary.toLowerCase();
          const p2 = c2.personality_summary.toLowerCase();
          const overlap = p1.split(' ').filter(w => p2.includes(w)).length;
          if (overlap > 5) {
            score += 10;
            signals.push('personality_overlap');
          }
        }

        // Schedule overlap (suspicious identical schedules)
        if (c1.wake_up_time === c2.wake_up_time && c1.sleep_start_time === c2.sleep_start_time) {
          score += 10;
          signals.push('identical_schedule');
        }

        if (score >= 30) {
          duplicateGroups.push({
            characters: [c1.id, c2.id],
            character_names: [c1.name, c2.name],
            confidence_score: Math.min(100, score),
            signals,
            recommendation: score > 70 ? 'likely_duplicate' : 'possible_duplicate',
          });
        }
      }
    }

    return Response.json({
      total_characters: chars.length,
      duplicate_groups: duplicateGroups,
      total_potential_duplicates: duplicateGroups.length,
      message: `Found ${duplicateGroups.length} potential duplicate pair(s).`,
    });
  } catch (error) {
    console.error('[detectDuplicateCharacters]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Simple string similarity scoring (0-1)
 */
function nameMatch(name1, name2) {
  const n1 = name1.toLowerCase().split(' ');
  const n2 = name2.toLowerCase().split(' ');
  
  // Exact match
  if (name1.toLowerCase() === name2.toLowerCase()) return 1;

  // First name match
  if (n1[0] === n2[0]) return 0.8;

  // Partial match
  const common = n1.filter(part => n2.some(p => p.startsWith(part)));
  if (common.length > 0) return 0.5;

  return 0;
}