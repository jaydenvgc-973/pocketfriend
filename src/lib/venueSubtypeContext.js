/**
 * Environmental context for venue types that describe a kind of settlement rather than
 * a single scenery type. Pure data — the location form shows it beside the selected
 * venue type so the location is described by what it actually is, not by an assumption
 * about the place or the people in it.
 */

export const VENUE_SUBTYPE_CONTEXT = {
  slums:
    "Overcrowded, deteriorated or informal residential area: housing quality or access to essential services may be inadequate. " +
    "May involve overcrowded housing, deteriorated or informal structures, limited safe drinking water, inadequate sanitation, insecure tenure or poorly maintained infrastructure. " +
    "Slums have no single appearance — older formal housing, informal settlements and self-built communities all qualify. Describe this specific location rather than assuming the same visual conditions.",
  city:
    "A relatively large, permanent, densely populated settlement with established economic, social and civic functions: residential and commercial districts, roads and public transportation, municipal buildings, utilities and infrastructure, pedestrian areas, business and community activity, varied architecture and densities. " +
    "Cities vary greatly in size, development, architecture and infrastructure — a city is not automatically a downtown skyline.",
  neighborhood:
    "A localized community within a city, town, suburb or rural area: residential streets, local businesses, schools and parks, sidewalks and pedestrian spaces, community gathering areas, recognizable or informally understood boundaries, distinctive local architecture and shared community spaces. " +
    "Neighborhoods may be urban, suburban or rural — a neighborhood is not automatically residential suburbia.",
};

// Environmental context for the venue types selected on a location.
export function getVenueSubtypeContext(category, subtype) {
  const selected = Array.isArray(subtype) ? subtype : subtype ? [subtype] : [];
  return selected
    .filter((s) => VENUE_SUBTYPE_CONTEXT[s])
    .map((s) => ({ subtype: s, context: VENUE_SUBTYPE_CONTEXT[s] }));
}