import { base44 } from "@/api/base44Client";
import { resolveCharacterContacts } from "@/lib/characterContactsResolver";

/**
 * narrativeShareRecipients.js
 *
 * Builds the recipient list for the narrative Share option on Chat and Text.
 *
 * Two groups, each sorted A → Z:
 *   1. own     — the current user's own active characters (existing behavior)
 *   2. crossAccount — characters belonging to OTHER accounts who are already
 *      known to the character whose narrative is being shared.
 *
 * "Known" comes from the app's existing contact graph via
 * resolveCharacterContacts (family_members, fictional_relationships,
 * people_in_world, conversation-linked contacts). Nothing outside that graph
 * is included — this is not a global character search.
 */

function byName(a, b) {
  return (a?.name || "").localeCompare(b?.name || "");
}

export async function resolveNarrativeShareRecipients({ message, me }) {
  if (!me?.email) return { own: [], crossAccount: [] };

  const ownChars = await base44.entities.Character
    .filter({ status: "active", owner_email: me.email })
    .catch(() => []);

  const own = (ownChars || []).slice().sort(byName);
  const ownIds = new Set(own.map(c => c.id));

  const originId = message?.character_id;
  if (!originId) return { own, crossAccount: [] };

  // The character whose narrative is being shared is the origin of the contact graph.
  let origin = own.find(c => c.id === originId) || null;
  if (!origin) {
    origin = await base44.entities.Character.get(originId).catch(() => null);
  }
  if (!origin) return { own, crossAccount: [] };

  const contacts = await resolveCharacterContacts(origin, me.email, me).catch(() => []);

  const candidateIds = [...new Set(
    (contacts || [])
      .map(c => c?.related_character_id)
      .filter(id => id && id !== originId && !ownIds.has(id))
  )];
  if (candidateIds.length === 0) return { own, crossAccount: [] };

  // Verified contact-graph fetch — returns full records, including owner_email.
  const res = await base44.functions
    .invoke("fetchCharactersByIds", { ids: candidateIds })
    .catch(() => null);
  const records = res?.data?.characters || [];

  const myEmail = me.email.toLowerCase();
  const crossAccount = records
    .filter(c => c && c.id && !ownIds.has(c.id))
    .filter(c => c.owner_email && c.owner_email.toLowerCase() !== myEmail)
    .filter(c => !["deleted", "soft_deleted", "merged"].includes(c.status))
    .filter(c => c.life_status !== "deceased")
    .sort(byName);

  return { own, crossAccount };
}