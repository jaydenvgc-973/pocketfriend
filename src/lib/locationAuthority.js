/**
 * locationAuthority — who answers for a place INSIDE the world.
 *
 * Two different things are never interchangeable:
 *
 *   Application facts      who owns the record, who administers the app, who shares
 *                          access, who edited or corrected the configuration, who is
 *                          viewing the scene.
 *   In-world authority     the assigned mayor, governor, president, owner, landlord,
 *                          property manager, business manager — an actual role at
 *                          this place, recorded on this place.
 *
 * Only the second kind may be described as responsibility for a place. This module reads
 * the roles the location record actually holds (its leadership assignments, and its
 * assigned owner) and states nothing that was not configured. It assigns nobody, creates
 * nobody, and never changes a record.
 */
import { getParentLocationType } from './genericParentLocation';

/** The established in-world authority of a place, from that place's own records. */
export function resolveLocationAuthority(location) {
  if (!location) return [];
  const out = [];
  const seen = new Set();
  const push = (role, name) => {
    const r = String(role || '').trim();
    const n = String(name || '').trim();
    if (!r || !n) return;
    const key = `${r.toLowerCase()}|${n.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ role: r, name: n });
  };

  // Roles assigned at this place (a city's Mayor, a country's President, a building's
  // Property Manager). Never inferred from the category or from who created the record.
  (location.leadership_assignments || []).forEach((a) => {
    push(a?.role, a?.character_name || a?.npc_name);
  });

  // The owner the place itself names — a character or an NPC. An account owner is a
  // different field (owner_email) and is never a role in the world.
  push(location.owner_role || 'Owner', location.owner_character_name || location.owner_npc_name);

  return out;
}

/** The whole-space label this place answers as (a city, a building), when it has one. */
export function describePlaceKind(location) {
  if (!location) return null;
  const parentType = getParentLocationType ? getParentLocationType(location) : null;
  const parentValue = typeof parentType === 'string' ? parentType : parentType?.value;
  if (parentValue && parentValue !== 'other') return String(parentValue).replace(/_/g, ' ');
  return String(location.category || '').replace(/_/g, ' ') || null;
}

/**
 * The block that keeps in-world authority and application access apart.
 * Empty only when there is no location at all.
 */
export function buildLocationAuthorityBlock(location) {
  if (!location) return '';
  const authority = resolveLocationAuthority(location);
  const kind = describePlaceKind(location);

  const place = kind ? `this ${kind}` : 'this place';
  const authorityLines = authority.length > 0
    ? [
        ...authority.map((a) => `- ${a.role}: ${a.name}. This role is recorded on this place itself.`),
        `- Responsibility for ${place} sits with the people named above. Municipal departments, staff, contractors, employees and previous administrations may carry out or have carried out the work, and may be discussed as possibilities or as uncertainty — never stated as fact unless something established says so.`,
        '- Anyone here may criticize or defend the people above, question them, or argue about what they inherited or what they are neglecting. What must stay accurate is who holds the responsibility, not what anyone thinks of them.',
      ].join('\n')
    : `- No in-world owner, leader, manager or other responsible person is recorded for ${place}. Nobody may be described as running it, owning it, or being answerable for it, and no one may be handed that responsibility to fill the gap.`;

  return `=== WHO ANSWERS FOR THIS PLACE (ESTABLISHED IN-WORLD AUTHORITY) ===
${authorityLines}

=== APPLICATION ACCESS IS NOT AN IN-WORLD ROLE ===
- Who owns this place's record, who administers the application, who has shared access, who edited or corrected its configuration, and who is viewing this scene are facts about the application. They are not jobs, ownership, tenancy, employment or authority inside this world.
- Nobody becomes a mayor, governor, leader, landlord, owner, property manager, building manager, supervisor, administrator or maintenance worker here because they created the record, edited it, administer the application, can travel here, are permitted inside, or are watching.
- A role in this world exists only when it is established as one: an assigned leadership or ownership record, a job at this place, a residence here, or a relationship that actually happened. Without that, a person who is not named above holds no responsibility for this place.
- A person may be talked about as someone who is somewhere else, or as someone these people know. Knowing someone is not authority over this place.
- If something said earlier in this conversation credited someone with responsibility here that is not established above, it was mistaken: do not repeat it, agree with it, or build on it. Simply stop treating it as true.`;
}

export default buildLocationAuthorityBlock;