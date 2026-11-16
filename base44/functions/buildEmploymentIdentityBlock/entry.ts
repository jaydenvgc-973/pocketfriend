/**
 * buildEmploymentIdentityBlock
 *
 * Extracted helper used by buildCanonicalCharacterContext — the employment-context
 * source read by Chat, Text, Scene and employment-related narratives. Returns the
 * block that tells a character who actually employs them and where that employer
 * physically operates.
 *
 * A business can operate inside a larger property (Agency (NJ) inside Gateway House).
 * The employer is the configured business that ALREADY claims this character in the
 * property's workplaces[].worker_character_ids. The property is only the building that
 * business operates inside.
 *
 * READ-ONLY. It never creates, moves, or reassigns employment, and changes no title,
 * rate, schedule, shift, location, or residence.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function resolveEmploymentLink(sr, locationId, characterId) {
  if (!locationId || !characterId) return null;
  const loc = await sr.entities.LocationReference.get(locationId).catch(() => null);
  if (!loc) return null;
  const workplaces = Array.isArray(loc.workplaces) ? loc.workplaces : [];
  const workplace = workplaces.find((w) => (w?.worker_character_ids || []).includes(characterId)) || null;
  return {
    location_name: loc.name || null,
    employer_name: workplace?.name || loc.name || null,
    workplace_name: workplace?.name || null,
    business_type: workplace?.business_type || null,
    job_title: loc.worker_job_titles?.[characterId] || null,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { characterId, occupationLocationId = null, occupationLocationName = null, additionalOccupationLocations = [] } = body;
    if (!characterId) return Response.json({ error: 'characterId is required' }, { status: 400 });

    const sr = base44.asServiceRole;

    const links = [];
    if (occupationLocationId) links.push(occupationLocationId);
    (Array.isArray(additionalOccupationLocations) ? additionalOccupationLocations : [])
      .forEach((a) => { if (a?.location_id) links.push(a.location_id); });
    const unique = [...new Set(links)].slice(0, 4);
    if (unique.length === 0) return Response.json({ employmentBlock: '', employers: [] });

    const resolved = [];
    for (const locationId of unique) {
      const link = await resolveEmploymentLink(sr, locationId, characterId);
      if (link) resolved.push(link);
    }

    // Only a business operating inside another location needs this clarification.
    // A standalone business whose name is also its location is already stated once.
    const split = resolved.filter((r) => r.workplace_name && r.employer_name && r.employer_name !== r.location_name);
    if (split.length === 0) return Response.json({ employmentBlock: '', employers: [] });

    const lines = split.map((r) => {
      const title = (r.job_title || '').trim();
      return `- Employer: ${r.employer_name} — the business or organization that employs you and pays you.${title ? ` Your position: ${title}.` : ''}\n  Physical workplace: ${r.location_name} — the building ${r.employer_name} operates inside. You go there to work, but ${r.location_name} itself does not employ you.`;
    });

    const employers = [...new Set(split.map((r) => r.employer_name))];
    const places = [...new Set(split.map((r) => r.location_name))];

    const employmentBlock = `\n\nEMPLOYMENT IDENTITY — WHO EMPLOYS YOU vs WHERE YOU WORK (authoritative; outranks any assumption taken from a building's name):\n${lines.join('\n')}\nSaying you work at ${places.join(' or ')} is natural and correct. Your employer, your boss, company leadership, your business's own operations, and who pays you are ${employers.join(' or ')} — never the building, and never another business operating inside it. Do not explain this distinction unless the conversation calls for it; simply be accurate when it does.`;

    return Response.json({
      employmentBlock,
      employers: split.map((r) => ({
        employer_name: r.employer_name,
        location_name: r.location_name,
        workplace_name: r.workplace_name,
        job_title: r.job_title,
      })),
    });
  } catch (error) {
    // A failed delegate must never suppress the character's own context — it returns
    // no employment block rather than blocking the canonical prompt.
    return Response.json({ employmentBlock: '', employers: [], error: error.message });
  }
});