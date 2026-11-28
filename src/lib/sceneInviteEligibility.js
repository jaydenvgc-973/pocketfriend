/**
 * sceneInviteEligibility.js
 *
 * WHO MAY BE SENT AN INVITATION from the existing Scenes Invite Character activity.
 *
 * This decides eligibility only — never acceptance. Whether an invited character
 * actually comes is still decided by the existing invitation response
 * (inviteCharacterToLocation) from their own circumstances, personality and mood.
 *
 * It reads only information that already exists:
 *   - the character's own record (custody fields, age)
 *   - the established parent-child entries already written into family_members and
 *     fictional_relationships by the app's own birth and relationship systems
 *   - the established contact graph (resolveCharacterContacts) for familiarity
 *
 * No new relationship, parenting or familiarity system lives here.
 */

import { isInfantCharacter } from "@/lib/characterAgeStage";

export const INVITE_RESTRICTIONS = {
  incarcerated: "Currently incarcerated",
  needsParent: "Select a parent first",
  unknown: "No selected participant knows this character",
};

// The labels the app's own relationship and birth systems write for a parent.
const PARENT_LABEL = /^(mother|mom|mommy|mama|ma|father|dad|daddy|papa|pa|parent|parents)$/i;
// A parent's own entry naming the child.
const CHILD_LABEL = /^(son|daughter|child|baby|infant|newborn)$/i;

const norm = (v) => String(v || "").trim().toLowerCase();

/** The character id a family/relationship entry points at, when it carries one. */
function memberLink(entry) {
  if (!entry) return null;
  const direct = entry.character_id || entry.related_character_id || entry._linked_character_id;
  if (direct) return direct;
  // The existing birth records name the parent in _member_id: birth_mother_<id>.
  const m = String(entry._member_id || "").match(/^birth_(?:mother|father|parent)_(.+)$/);
  return m ? m[1] : null;
}

/**
 * The baby's established parents, read from the relationship data already on the
 * records. Parenthood is never inferred from surnames, residence or proximity.
 */
export function resolveParentIds(character, characters = []) {
  if (!character?.id) return [];
  const ids = new Set();

  for (const member of character.family_members || []) {
    if (!PARENT_LABEL.test(norm(member?.relationship_type))) continue;
    const id = memberLink(member);
    if (id && id !== character.id) ids.add(id);
  }
  for (const rel of character.fictional_relationships || []) {
    if (!PARENT_LABEL.test(norm(rel?.relationship_type))) continue;
    const id = rel?.source_character_id || rel?.related_character_id;
    if (id && id !== character.id) ids.add(id);
  }

  // A parent's own record naming this child establishes the same parent.
  const childName = norm(character.name);
  for (const other of characters || []) {
    if (!other?.id || other.id === character.id) continue;
    const entries = [
      ...(other.family_members || []).map((e) => ({ label: e?.relationship_type, link: memberLink(e), name: e?.name })),
      ...(other.fictional_relationships || []).map((e) => ({
        label: e?.relationship_type,
        link: e?.related_character_id || e?.source_character_id,
        name: e?.person_name,
      })),
    ];
    const isParent = entries.some((e) => CHILD_LABEL.test(norm(e.label))
      && (e.link === character.id || (!!childName && norm(e.name) === childName)));
    if (isParent) ids.add(other.id);
  }

  return [...ids];
}

/** The app's existing custody authority, limited to actual incarceration. */
export function isCurrentlyIncarcerated(character) {
  if (!character) return false;
  if (character.is_jailed === true) return true;
  return character.resolved_presence_status === "incarcerated"
    || character.resolved_presence_status === "confined";
}

/**
 * The single restriction that currently prevents an invitation, or null when the
 * character may be invited. When several apply, the absolute one wins: custody is
 * never overridden by familiarity or by a selected parent.
 */
export function inviteRestrictionFor({
  person,
  record = null,
  observeMode = false,
  selectedIds = new Set(),
  knownIds = new Set(),
  knownNames = new Set(),
  characters = [],
}) {
  const subject = record || person;
  if (!subject) return null;

  if (isCurrentlyIncarcerated(subject)) return INVITE_RESTRICTIONS.incarcerated;

  // A baby cannot be invited independently: only alongside a parent who is already
  // selected as an invitation recipient in this same list.
  if (isInfantCharacter(subject)) {
    const parents = resolveParentIds(subject, characters);
    if (!parents.some((id) => selectedIds.has(id))) return INVITE_RESTRICTIONS.needsParent;
    return null;
  }

  // Watching a scene without taking part: someone in it must already know them.
  if (observeMode) {
    const id = person?.canonical_person_id || subject.id;
    const known = knownIds.has(id) || (!!subject.name && knownNames.has(norm(subject.name)));
    if (!known) return INVITE_RESTRICTIONS.unknown;
  }

  return null;
}