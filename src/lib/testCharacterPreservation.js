import { base44 } from '@/api/base44Client';

/**
 * TEST CHARACTER PRESERVATION BOUNDARY
 *
 * The Test Character designation authorizes test ELIGIBILITY. It never authorizes
 * changing a pre-existing character's name, type, status, active status, homepage
 * placement, visibility or ownership.
 *
 * Before this boundary, designating a character for testing silently removed it from
 * the homepage, because the homepage roster excluded every record carrying the
 * designation. Reverting a name did not bring it back: visibility followed the
 * designation, not the name.
 *
 * This module records what the character looked like BEFORE the designation, so the
 * designation can only ever add eligibility. A character that was on the homepage
 * before testing keeps that placement during and after the test.
 *
 * Test-created fixtures are a different thing entirely: they are temporary records a
 * test made for itself (test_fixture_origin + Disposable). They are never preserved
 * and never appear in the user's world.
 */

// Settings a test must never be able to change on a pre-existing character.
export const PROTECTED_CHARACTER_SETTINGS = [
  'name',
  'display_name',
  'primary_name',
  'full_name',
  'aliases',
  'age',
  'birthday',
  'birth_year',
  'character_type',
  'status',
  'life_status',
  'is_active_character',
  'exclude_from_homepage',
  'exclude_from_roster',
  'exclude_from_default_scene_queries',
  'is_default',
  'diagnostic_only',
  'owner_email',
  'owner_user_id',
  'created_by_role',
  'visibility_scope',
  'data_scope',
  'avatar_url',
];

/** A character a test run created for itself — temporary, never preserved. */
export function isTestCreatedFixture(character) {
  return !!character?.test_fixture_origin && character.is_disposable === true;
}

/** Whether this character is displayed on the homepage right now, by the homepage's own rules. */
export function isHomepageVisible(character) {
  if (!character) return false;
  if (character.is_test_character === true || character.diagnostic_only === true) return false;
  return character.character_type === 'active_created_character'
    && (character.status === 'active' || !character.status)
    && character.exclude_from_homepage !== true
    && character.is_world_service !== true;
}

const snapshotOf = (character) =>
  Object.fromEntries(PROTECTED_CHARACTER_SETTINGS.map((key) => [key, character?.[key] ?? null]));

/**
 * Record a character's pre-test settings at the moment it is designated for testing.
 * A fixture is never preserved, and an existing snapshot is never replaced — the first
 * designation is the state that is protected.
 */
export async function recordTestingPreservation(character) {
  if (!character?.id || isTestCreatedFixture(character)) return null;
  const existing = await base44.entities.TestCharacterPreservation
    .filter({ character_id: character.id }, null, 5)
    .catch(() => []);
  if (existing.length) return existing[0];
  return base44.entities.TestCharacterPreservation.create({
    character_id: character.id,
    character_name: character.name || '',
    owner_email: character.owner_email || '',
    designated_at: new Date().toISOString(),
    homepage_visible_before_testing: isHomepageVisible(character),
    protected_settings: snapshotOf(character),
  }).catch(() => null);
}

/** The designation was removed: there is nothing left to preserve. */
export async function clearTestingPreservation(characterId) {
  if (!characterId) return;
  await base44.entities.TestCharacterPreservation.deleteMany({ character_id: characterId }).catch(() => {});
}

/**
 * IDs of test-designated characters that were on the homepage BEFORE they were
 * designated. The homepage roster keeps exactly these in place; every other test
 * character and fixture stays out of the user's world.
 */
export async function preservedHomepageCharacterIds(characters) {
  const flagged = (characters || [])
    .filter((c) => c?.is_test_character === true && !isTestCreatedFixture(c))
    .map((c) => c.id)
    .filter(Boolean);
  if (!flagged.length) return new Set();
  const rows = await base44.entities.TestCharacterPreservation
    .filter({ character_id: { $in: flagged } }, null, flagged.length)
    .catch(() => []);
  return new Set(
    rows.filter((r) => r.homepage_visible_before_testing === true).map((r) => r.character_id)
  );
}

/** Protected settings that differ from the snapshot — names only, for diagnosis. */
export function driftedProtectedSettings(snapshot, character) {
  if (!snapshot || !character) return [];
  return PROTECTED_CHARACTER_SETTINGS.filter((key) => {
    const before = snapshot[key] ?? null;
    const now = character[key] ?? null;
    return JSON.stringify(before) !== JSON.stringify(now);
  });
}