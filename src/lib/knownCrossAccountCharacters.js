import { base44 } from "@/api/base44Client";
import { resolveCharacterContacts } from "@/lib/characterContactsResolver";

/**
 * knownCrossAccountCharacters
 *
 * Resolves the characters from OTHER accounts that are already known to the
 * given character through the app's existing contact graph
 * (family_members, fictional_relationships, people in their world, and
 * verified conversation contacts via resolveCharacterContacts).
 *
 * This is the same identification path the Share Narrative recipient list
 * uses — nothing outside the existing contact graph is included.
 *
 * Returns full Character records (avatar_url, reference_image_urls,
 * appearance_lock, owner_email) so identity resolution and avatars work
 * exactly like an account-owned character.
 */
export async function resolveKnownCrossAccountCharacters({ originCharacter, user }) {
  if (!originCharacter?.id || !user?.email) return [];

  const contacts = await resolveCharacterContacts(originCharacter, user.email, user).catch(() => []);
  const candidateIds = [...new Set(
    (contacts || [])
      .map(c => c?.related_character_id)
      .filter(id => id && id !== originCharacter.id)
  )];
  if (candidateIds.length === 0) return [];

  // Verified contact-graph fetch — returns full records, ownership included.
  const res = await base44.functions
    .invoke("fetchCharactersByIds", { ids: candidateIds })
    .catch(() => null);
  const records = res?.data?.characters || [];

  const myEmail = user.email.toLowerCase();

  return records
    .filter(c => c && c.id && c.owner_email && c.owner_email.toLowerCase() !== myEmail)
    .filter(c => !["deleted", "soft_deleted", "merged"].includes(c.status))
    .filter(c => c.life_status !== "deceased")
    .map(c => ({ ...c, is_cross_account: true, account_email: c.owner_email }))
    .sort((a, b) =>
      (a.owner_email || "").localeCompare(b.owner_email || "") ||
      (a.name || "").localeCompare(b.name || "")
    );
}