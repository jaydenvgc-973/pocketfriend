/**
 * EMPLOYER IDENTITY
 *
 * An employer (income source) and the physical work location are two separate pieces
 * of information. A business can operate inside a larger property:
 *
 *   Employer:        Agency (NJ)
 *   Resolved location: Gateway House
 *
 * The existing workplace configuration on the property already records which business
 * each employee belongs to (location.workplaces[].worker_character_ids). This resolver
 * reads that existing assignment — it never creates, moves, or reassigns employment.
 *
 * When no configured business inside the property claims the character, the property
 * itself is the employer (a standalone business whose name is also its location), and
 * the name is shown once.
 */

/**
 * Resolve the employer of one employment link (a LocationReference).
 *
 * @param {object} location - LocationReference record (must include workplaces[])
 * @param {string} characterId - the employed character's id
 * @returns {object|null} { employer_name, workplace_id, business_type,
 *                          location_id, location_name, shows_location }
 */
export function resolveEmployerIdentity(location, characterId) {
  if (!location) return null;

  const workplaces = Array.isArray(location.workplaces) ? location.workplaces : [];
  const workplace = characterId
    ? workplaces.find((w) => (w?.worker_character_ids || []).includes(characterId)) || null
    : null;

  // RESIDENCE IS NOT EMPLOYMENT. A property that keeps businesses inside it is never
  // itself the employer: when none of those businesses claims this character, they have
  // no employer here — living there does not make the building their job.
  const hasWorkplaces = workplaces.some((w) => w?.workplace_id || w?.name);
  const employerName = workplace?.name || (hasWorkplaces ? null : location.name) || null;
  // Only show the location as a second line when it is genuinely a different name.
  const showsLocation = !!workplace?.name && workplace.name !== location.name;

  return {
    employer_name: employerName,
    workplace_id: workplace?.workplace_id || null,
    business_type: workplace?.business_type || null,
    location_id: location.id || null,
    location_name: location.name || null,
    shows_location: showsLocation,
  };
}