/**
 * backfillFamilyNPCCharacterData
 *
 * Scans all characters owned by the user and finds every family_members[] entry
 * that has a _linked_character_id. For each linked character, backfills:
 *   - age (from calcFamilyMemberAge equivalent)
 *   - gender (inferred from relationship_type)
 *   - age_range (derived from age)
 *   - personality_summary / profile_summary (if generic/missing)
 *
 * This repairs all existing npc_family_member records created before this data
 * was being written on creation.
 *
 * Safe: only updates missing or incorrect fields. Never deletes or overwrites
 * explicitly set values unless they are generic defaults.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const FEMALE_ROLES = new Set([
  'mother', 'mom', 'mommy', 'grandmother', 'grandma', 'great-grandmother',
  'aunt', 'niece', 'sister', 'half-sister', 'step-mother', 'stepmother',
  'stepsister', 'step-sister', 'daughter', 'mother-in-law', 'sister-in-law',
  'birth mother', 'biological mother', 'adoptive mother', 'foster mother',
  'maternal grandmother', 'paternal grandmother',
]);
const MALE_ROLES = new Set([
  'father', 'dad', 'daddy', 'grandfather', 'grandpa', 'great-grandfather',
  'uncle', 'nephew', 'brother', 'half-brother', 'step-father', 'stepfather',
  'stepbrother', 'step-brother', 'son', 'father-in-law', 'brother-in-law',
  'birth father', 'biological father', 'adoptive father', 'foster father',
  'maternal grandfather', 'paternal grandfather',
]);

function inferGender(relType) {
  const r = (relType || '').toLowerCase();
  if (FEMALE_ROLES.has(r)) return 'female';
  if (MALE_ROLES.has(r)) return 'male';
  return null;
}

function inferAgeRange(age) {
  if (age == null) return null;
  if (age <= 3) return 'toddler';
  if (age <= 12) return 'child';
  if (age <= 17) return 'teenager';
  if (age <= 25) return 'young adult';
  if (age <= 40) return 'adult';
  if (age <= 60) return 'middle aged';
  return 'senior';
}

// Equivalent of calcFamilyMemberAge from FamilyEditor
function calcCurrentAge(member, characterCreatedDate, index = 0) {
  const ageAtCreation = member.age_at_creation ?? member.age ?? null;
  const savedDate = member.age_set_date || characterCreatedDate;
  if (ageAtCreation == null || !savedDate) return null;

  const base = new Date(savedDate);
  const birthdayMonth = (base.getMonth() + index) % 12;
  const birthdayDay = base.getDate();
  const extraYears = Math.floor((base.getMonth() + index) / 12);

  const today = new Date();
  const thisYear = today.getFullYear();
  const baseYear = base.getFullYear() + extraYears;

  let birthday = new Date(thisYear, birthdayMonth, birthdayDay);
  if (birthday > today) birthday.setFullYear(thisYear - 1);

  const yearsPassed = birthday.getFullYear() - baseYear;
  return ageAtCreation + yearsPassed;
}

const GENERIC_SUMMARIES = new Set([
  'family member related to ethan nathan thompson.',
  'family member related to ethan thompson.',
  'family member.',
  '',
]);

function isGenericSummary(s) {
  return !s || GENERIC_SUMMARIES.has(s.toLowerCase().trim());
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all characters for this user
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null,
      300
    ).catch(() => []);

    // Build a map by ID for fast lookup
    const charById = new Map(allChars.map(c => [c.id, c]));

    const updated = [];
    const skipped = [];
    const errors = [];

    // For each character, scan their family_members[] for linked characters
    for (const char of allChars) {
      const familyMembers = char.family_members || [];
      if (familyMembers.length === 0) continue;

      for (let idx = 0; idx < familyMembers.length; idx++) {
        const m = familyMembers[idx];
        const linkedId = m._linked_character_id || m.character_id || null;
        if (!linkedId) continue;

        const linkedChar = charById.get(linkedId);
        if (!linkedChar) continue;

        // Build the update payload — only set fields that are missing or wrong
        const updates = {};

        // Age — calculate current age from parent's family_members entry
        const currentAge = calcCurrentAge(m, char.created_date, idx);
        if (currentAge != null && !linkedChar.age) {
          updates.age = currentAge;
        }

        // Gender — infer from relationship_type if missing or 'other'
        const gender = inferGender(m.relationship_type);
        if (gender && (!linkedChar.gender || linkedChar.gender === 'other')) {
          updates.gender = gender;
        }

        // age_range — derive from current age if missing or 'adult' (likely a default)
        const ageForRange = currentAge ?? linkedChar.age ?? null;
        const ageRange = inferAgeRange(ageForRange);
        if (ageRange && (!linkedChar.age_range || linkedChar.age_range === 'adult')) {
          updates.age_range = ageRange;
        }

        // personality_summary / profile_summary — fix generic "Family member related to X" blurbs
        const relLabel = m.relationship_type || 'family member';
        const parentName = char.name || 'their parent';
        if (isGenericSummary(linkedChar.personality_summary)) {
          updates.personality_summary = `${linkedChar.name} is ${parentName}'s ${relLabel}.`;
        }
        if (isGenericSummary(linkedChar.profile_summary)) {
          updates.profile_summary = `${linkedChar.name} is ${parentName}'s ${relLabel}.`;
        }

        if (Object.keys(updates).length === 0) {
          skipped.push({ id: linkedId, name: linkedChar.name, reason: 'already complete' });
          continue;
        }

        try {
          // Use user-scoped update (owner_email must match) — these NPCs belong to the user
          await base44.entities.Character.update(linkedId, updates);
          updated.push({
            id: linkedId,
            name: linkedChar.name,
            relationship: relLabel,
            parent: parentName,
            changes: Object.keys(updates),
            values: updates,
          });
          // Update the in-memory map so sibling lookups have fresh data
          charById.set(linkedId, { ...linkedChar, ...updates });
        } catch (err) {
          errors.push({ id: linkedId, name: linkedChar.name, error: err.message });
        }
      }
    }

    console.log(`[backfillFamilyNPCCharacterData] user=${user.email} | updated=${updated.length} | skipped=${skipped.length} | errors=${errors.length}`);

    return Response.json({
      success: true,
      summary: {
        total_chars_scanned: allChars.length,
        updated: updated.length,
        skipped: skipped.length,
        errors: errors.length,
      },
      updated,
      errors,
    });

  } catch (error) {
    console.error('[backfillFamilyNPCCharacterData]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});