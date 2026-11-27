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
 * RESIDENCE IS NOT EMPLOYMENT. A property that contains businesses never employs the
 * people who live in it. When no business inside the property claims this character,
 * the building is NOT their employer and the block says so, rather than falling back
 * to the property's name.
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
    location_id: locationId,
    location_name: loc.name || null,
    employer_name: workplace?.name || null,
    workplace_name: workplace?.name || null,
    business_type: workplace?.business_type || null,
    job_title: loc.worker_job_titles?.[characterId] || null,
    // A property that keeps businesses inside it is never itself an employer.
    has_workplaces: workplaces.some((w) => w?.workplace_id || w?.name),
    other_businesses: workplaces.filter((w) => w?.name && w.name !== workplace?.name).map((w) => w.name),
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

    // The property's own workplace record, by location id. The canonical prompt reads this
    // for its WORKPLACE line so it names the business rather than the building — one
    // resolution, used by both, so the two can never name different employers.
    const workplaceByLocation = {};
    resolved.forEach((r) => {
      if (r.workplace_name && r.location_id) {
        workplaceByLocation[r.location_id] = { workplace_name: r.workplace_name, location_name: r.location_name };
      }
    });

    // Only a property that keeps businesses inside it needs this clarification: either the
    // character is employed by one of those businesses, or by none of them. A standalone
    // business whose name is also its location is already stated once.
    const split = resolved.filter((r) => r.has_workplaces);
    if (split.length === 0) return Response.json({ employmentBlock: '', employers: [], workplaceByLocation });

    const lines = split.map((r) => {
      const title = (r.job_title || '').trim();
      if (r.employer_name) {
        return `- Employer: ${r.employer_name} — the business that employs you and pays you.${title ? ` Your position: ${title}.` : ''}\n  Physical workplace: ${r.location_name} — the building ${r.employer_name} operates inside. You go there to work, but ${r.location_name} itself does not employ you and living in it would never make it your employer. If anything else in your context names ${r.location_name} as your workplace, that is the address you report to, never the company that employs you — the company is ${r.employer_name}.`;
      }
      const others = r.other_businesses?.length ? ` (${r.other_businesses.join(', ')})` : '';
      return `- ${r.location_name} is the building where you live, not an employer. It contains its own businesses${others}, and none of them employs you, so neither ${r.location_name} nor any business inside it is your job. Do not name any of them as your employer, and never treat your residence as employment.`;
    });

    const employers = [...new Set(split.map((r) => r.employer_name).filter(Boolean))];
    const places = [...new Set(split.map((r) => r.location_name).filter(Boolean))];

    const employmentBlock = `\n\nEMPLOYMENT IDENTITY — WHO EMPLOYS YOU vs WHERE YOU WORK (authoritative; outranks any assumption taken from a building's name or from where someone lives):\n${lines.join('\n')}\n${employers.length > 0
      ? `Your employer, your boss, company leadership, your business's own operations, and who pays you are ${employers.join(' or ')}. ${places.length > 0 ? `${places.join(' or ')} is the building, never the employer.` : ''} Say who you work for by naming ${employers.join(' or ')} — the building is only where that work happens.`
      : 'You have no employer inside that building. If asked who you work for, say honestly that none of the businesses there employs you — never name the building or one of its businesses as your job.'} Living somewhere is never employment: residence, a residential unit assignment, or simply being present in a building never makes anyone an employee of it or of the businesses inside it. Do not explain this distinction unless the conversation calls for it; simply be accurate when it does.`;

    return Response.json({
      employmentBlock,
      workplaceByLocation,
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