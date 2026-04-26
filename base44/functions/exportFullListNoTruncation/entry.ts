import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * EXPORT FULL LIST - NO TRUNCATION
 * 
 * Returns complete list formatted for readability without response truncation
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const KNOWN_EXPORTED = [
      'Andre Rivera',
      'Ava Dei Park',
      'Brian Anderson',
      'Ethan Thompson',
      'James Anderson',
      'Jonathan Anthony Smith',
      'Lila Green',
      'Matt Lopez',
      'Melody Jackson Perry',
      'Nathan Parker',
    ];

    // Fetch all records
    const userRoleCharacters = await base44.entities.Character.list('-updated_date', 500);
    const serviceRoleCharacters = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const characterAliases = await base44.asServiceRole.entities.CharacterAlias.list(null, 500).catch(() => []);
    const userRoleDeleted = await base44.entities.Character.filter(
      { status: { $in: ['deleted', 'soft_deleted', 'moved_away', 'merged'] } },
      null,
      500
    ).catch(() => []);
    const serviceRoleDeleted = await base44.asServiceRole.entities.Character.filter(
      { status: { $in: ['deleted', 'soft_deleted', 'moved_away', 'merged'] } },
      null,
      500
    ).catch(() => []);

    const records = [];
    const classifiedNames = new Set();

    // Known exported
    for (const name of KNOWN_EXPORTED) {
      const u = userRoleCharacters.find(c => c.name === name);
      const s = serviceRoleCharacters.find(c => c.name === name);
      const a = characterAliases.find(a => a.alias_name === name);
      const ud = userRoleDeleted.find(c => c.name === name);
      const sd = serviceRoleDeleted.find(c => c.name === name);

      if (u) { records.push(`${records.length + 1}. ${name} | Character | user | active | known`); classifiedNames.add(name); }
      else if (s) { records.push(`${records.length + 1}. ${name} | Character | service | active | known`); classifiedNames.add(name); }
      else if (a) { records.push(`${records.length + 1}. ${name} | CharacterAlias | service | alias | known`); classifiedNames.add(name); }
      else if (ud) { records.push(`${records.length + 1}. ${name} | Character | user | ${ud.status} | known`); classifiedNames.add(name); }
      else if (sd) { records.push(`${records.length + 1}. ${name} | Character | service | ${sd.status} | known`); classifiedNames.add(name); }
    }

    // Unclassified user role
    userRoleCharacters
      .filter(c => !classifiedNames.has(c.name))
      .forEach(c => {
        records.push(`${records.length + 1}. ${c.name} | Character | user | ${c.status} | unclassified`);
      });

    // Unclassified service role
    serviceRoleCharacters
      .filter(c => !classifiedNames.has(c.name))
      .forEach(c => {
        records.push(`${records.length + 1}. ${c.name} | Character | service | ${c.status} | unclassified`);
      });

    // Unclassified user archived
    userRoleDeleted
      .filter(c => !classifiedNames.has(c.name))
      .forEach(c => {
        records.push(`${records.length + 1}. ${c.name} | Character | user | ${c.status} | unclassified`);
      });

    // Unclassified service archived
    serviceRoleDeleted
      .filter(c => !classifiedNames.has(c.name))
      .forEach(c => {
        records.push(`${records.length + 1}. ${c.name} | Character | service | ${c.status} | unclassified`);
      });

    // Unclassified aliases
    characterAliases
      .filter(a => !classifiedNames.has(a.alias_name))
      .forEach(a => {
        records.push(`${records.length + 1}. ${a.alias_name} | CharacterAlias | service | alias | unclassified`);
      });

    return Response.json({
      total: records.length,
      format: 'rank. name | entity | role | status | export_source',
      records,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});