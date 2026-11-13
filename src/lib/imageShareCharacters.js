import { base44 } from "@/api/base44Client";

/**
 * Shared helpers for image sharing on Scenes and Gathering Rooms.
 *
 * Recipients are always presented alphabetically and always distinguish the
 * user's own characters from characters that belong to another account.
 * Account identity comes from Character.owner_email — the same ownership field
 * the rest of the app already uses.
 */

const INACTIVE_STATUSES = new Set(["deleted", "soft_deleted", "merged"]);

export function alphabetizeByName(list) {
  return [...(list || [])].sort((a, b) => {
    const aName = (a?.name || "").trim().toLowerCase();
    const bName = (b?.name || "").trim().toLowerCase();
    return aName.localeCompare(bName);
  });
}

function displayNameOf(character) {
  return character?.name || character?.display_name || character?.primary_name || "Character";
}

/**
 * The user's own characters — valid senders and recipients.
 * Legacy characters with missing newer fields stay included; only explicitly
 * deleted/merged records are excluded.
 */
export function buildOwnShareCharacters(characters, ownerEmail) {
  const seen = new Set();
  const collected = [];
  (characters || []).forEach((character) => {
    if (!character?.id || seen.has(character.id)) return;
    if (String(character.id).startsWith("npc_")) return;
    if (character.is_user) return;
    if (INACTIVE_STATUSES.has(character.status)) return;
    if (character.owner_email && ownerEmail && character.owner_email !== ownerEmail) return;
    seen.add(character.id);
    collected.push({
      id: character.id,
      name: displayNameOf(character),
      avatar_url: character.avatar_url || null,
      is_other_account: false,
    });
  });
  return alphabetizeByName(collected);
}

/**
 * Characters belonging to a different account.
 */
export function buildOtherAccountCharacters(characters, ownerEmail) {
  const seen = new Set();
  const collected = [];
  (characters || []).forEach((character) => {
    if (!character?.id || seen.has(character.id)) return;
    if (INACTIVE_STATUSES.has(character.status)) return;
    if (!character.owner_email || character.owner_email === ownerEmail) return;
    seen.add(character.id);
    collected.push({
      id: character.id,
      name: displayNameOf(character),
      avatar_url: character.avatar_url || null,
      is_other_account: true,
    });
  });
  return alphabetizeByName(collected);
}

/**
 * Cross-account recipients reachable through the existing World Phone contact
 * graph: characters the user's own characters already know (related_character_id
 * on fictional_relationships), recovered through the existing
 * fetchCharactersByIds contact-graph resolver.
 */
export async function loadCrossAccountContacts({ characterRecords = [], ownerEmail, excludeIds = [] } = {}) {
  const knownIds = new Set();
  (characterRecords || []).forEach((character) => {
    (character?.fictional_relationships || []).forEach((rel) => {
      if (rel?.related_character_id) knownIds.add(rel.related_character_id);
    });
    // Family members linked to a real character record are part of the same
    // established contact graph the Media Grid generator uses.
    (character?.family_members || []).forEach((member) => {
      if (member?.character_id) knownIds.add(member.character_id);
    });
  });

  const requested = [...knownIds].filter((id) => !excludeIds.includes(id)).slice(0, 100);
  if (requested.length === 0) return [];

  const res = await base44.functions.invoke("fetchCharactersByIds", { ids: requested }).catch(() => null);
  const found = res?.data?.characters || [];
  return buildOtherAccountCharacters(found, ownerEmail);
}