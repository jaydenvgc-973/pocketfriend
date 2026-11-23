import { base44 } from "@/api/base44Client";

/**
 * governmentCrossAccountCharacters.js
 *
 * The characters from OTHER accounts that this account already knows, for the
 * government venue setup modals (City Hall / Courthouse participant selection).
 *
 * This adds no new access path: it reads the same contact graph the rest of
 * Pocketfriend uses (fictional_relationships, family_members on the account's own
 * characters) and hands the referenced IDs to fetchCharactersByIds, which verifies
 * every ID against the caller's own contact graph before returning a record.
 * Nothing outside that graph is included — this is not a character directory search.
 */
export async function resolveGovernmentCrossAccountCharacters({ ownCharacters = [], userEmail }) {
  if (!userEmail) return [];

  const ownIds = new Set((ownCharacters || []).map((c) => c?.id).filter(Boolean));
  const referenced = new Set();
  for (const c of ownCharacters || []) {
    for (const rel of (c.fictional_relationships || [])) {
      if (rel?.related_character_id) referenced.add(rel.related_character_id);
    }
    for (const fm of (c.family_members || [])) {
      const id = fm?.character_id || fm?.related_character_id;
      if (id) referenced.add(id);
    }
  }

  const ids = [...referenced].filter((id) => id && !ownIds.has(id));
  if (ids.length === 0) return [];

  const res = await base44.functions.invoke("fetchCharactersByIds", { ids }).catch(() => null);
  const records = res?.data?.characters || [];
  const mine = userEmail.toLowerCase();

  return records
    .filter((c) => c?.id && c.owner_email && c.owner_email.toLowerCase() !== mine)
    .filter((c) => !["deleted", "soft_deleted", "merged"].includes(c.status))
    .filter((c) => c.life_status !== "deceased")
    .map((c) => ({ ...c, is_cross_account: true, account_email: c.owner_email }))
    .sort((a, b) =>
      (a.owner_email || "").localeCompare(b.owner_email || "") ||
      (a.name || "").localeCompare(b.name || "")
    );
}

/**
 * Whether a record belongs to the given account. A legacy record with no owner_email
 * that is visible in the account's own roster is treated as the account's own — legacy
 * characters are never hidden from a selector.
 */
export function isOwnAccountCharacter(character, userEmail) {
  if (!character) return false;
  if (!character.owner_email) return true;
  if (!userEmail) return true;
  return character.owner_email.toLowerCase() === userEmail.toLowerCase();
}