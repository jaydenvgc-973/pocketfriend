import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const KNOWN = ['Andre Rivera', 'Ava Dei Park', 'Brian Anderson', 'Ethan Thompson', 'James Anderson', 'Jonathan Anthony Smith', 'Lila Green', 'Matt Lopez', 'Melody Jackson Perry', 'Nathan Parker'];

    const ur = await base44.entities.Character.list('-updated_date', 500);
    const sr = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const ca = await base44.asServiceRole.entities.CharacterAlias.list(null, 500).catch(() => []);
    const ud = await base44.entities.Character.filter({ status: { $in: ['deleted', 'soft_deleted', 'moved_away', 'merged'] } }, null, 500).catch(() => []);
    const sd = await base44.asServiceRole.entities.Character.filter({ status: { $in: ['deleted', 'soft_deleted', 'moved_away', 'merged'] } }, null, 500).catch(() => []);

    const cn = new Set();
    const names = [];

    // Known
    for (const n of KNOWN) {
      if (ur.find(c => c.name === n)) { names.push(n); cn.add(n); }
      else if (sr.find(c => c.name === n)) { names.push(n); cn.add(n); }
      else if (ca.find(a => a.alias_name === n)) { names.push(n); cn.add(n); }
      else if (ud.find(c => c.name === n)) { names.push(n); cn.add(n); }
      else if (sd.find(c => c.name === n)) { names.push(n); cn.add(n); }
    }

    // Unclassified
    ur.forEach(c => { if (!cn.has(c.name)) { names.push(c.name); cn.add(c.name); } });
    sr.forEach(c => { if (!cn.has(c.name)) { names.push(c.name); cn.add(c.name); } });
    ud.forEach(c => { if (!cn.has(c.name)) { names.push(c.name); cn.add(c.name); } });
    sd.forEach(c => { if (!cn.has(c.name)) { names.push(c.name); cn.add(c.name); } });
    ca.forEach(a => { if (!cn.has(a.alias_name)) { names.push(a.alias_name); cn.add(a.alias_name); } });

    return Response.json({ total: names.length, names });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});