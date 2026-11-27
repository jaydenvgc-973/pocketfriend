/**
 * placeAuthority — who answers for a place INSIDE the world.
 *
 * A location's leadership assignments (a city's Mayor, a country's President, a building's
 * Property Manager) and its assigned owner (a character or an NPC) are in-world roles.
 *
 * Its account owner (owner_email), the administrator who edited it, the accounts sharing
 * it and whoever is viewing it are application facts. They are never read here, because
 * they are never a role in the world. Nothing in this module assigns anybody or changes
 * any record: it only states roles the place itself already holds.
 */

export interface PlaceAuthorityRole {
  role: string;
  name: string;
}

export function resolvePlaceAuthority(place: any): PlaceAuthorityRole[] {
  if (!place) return [];
  const out: PlaceAuthorityRole[] = [];
  const seen = new Set<string>();
  const push = (role: any, name: any) => {
    const r = String(role || '').trim();
    const n = String(name || '').trim();
    if (!r || !n) return;
    const key = `${r.toLowerCase()}|${n.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ role: r, name: n });
  };
  (place.leadership_assignments || []).forEach((a: any) => push(a?.role, a?.character_name || a?.npc_name));
  push(place.owner_role || 'Owner', place.owner_character_name || place.owner_npc_name);
  return out;
}

/** The prompt lines that keep in-world authority and application access apart. */
export function buildPlaceAuthorityLines(place: any): string[] {
  if (!place) return [];
  const authority = resolvePlaceAuthority(place);
  return [
    authority.length > 0
      ? `ESTABLISHED AUTHORITY HERE: ${authority.map((a) => `${a.role} — ${a.name}`).join('; ')}. Responsibility for this place sits with them, and nobody else holds it. Staff, departments, contractors and previous administrations may carry out the work, and may be discussed as possibilities or uncertainty — never stated as fact unless something established says so.`
      : 'ESTABLISHED AUTHORITY HERE: no in-world owner, leader, manager or other responsible person is recorded for this place. Nobody may be described as running it or being answerable for it, and no one may be handed that responsibility to fill the gap.',
    'APPLICATION ACCESS IS NOT AN IN-WORLD ROLE: who owns this place\'s record, who administers the application, who shares access, who edited or corrected its configuration, and who is viewing it are application facts — never a job, ownership, tenancy or authority in this world. Never describe anyone as a mayor, leader, landlord, owner, manager, supervisor, administrator or maintenance worker here on that basis. A role exists only when it is recorded: an assigned leadership or ownership role, a job at this place, a residence here, or a relationship that actually happened. If an earlier message credited someone with responsibility here that is not recorded, it was mistaken — do not repeat it or build on it.',
  ];
}

export default buildPlaceAuthorityLines;