import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const EXPORT_MURQART = [
      'Andre Rivera', 'Ava Dei Park', 'Brian Anderson', 'Ethan Thompson',
      'James Anderson', 'Jonathan Anthony Smith', 'Lila Green', 'Matt Lopez',
      'Melody Jackson Perry', 'Nathan Parker', 'Carlos Mendez', 'Demi Rivers',
      'Mia Chen', 'Leah Park', 'Rick Taylor', 'Jordan Li', 'Mace',
      'Jasmine Rodriguez', 'Nick Decker', 'Udelka', 'Vanessa', 'Camila',
      'Sofia Garcia', 'Michael', 'Javier', 'Marisol', 'Terrance Gibbons',
      'Briar Kieran', 'Abuela Sophia', 'Amelia Johnson', 'Daniela', 'Kiara',
      'Nancy', 'Sarah', 'Larry', 'Stephanie'
    ];

    const EXPORT_ADOBEVGC = [
      'Mark', 'Ken', 'Chris Brown', 'Alden Spencer', 'Jayden Jackson', 'Mateo', 'Leo'
    ];

    const exportRows = [
      ...EXPORT_MURQART.map((name, idx) => ({ row: idx + 1, name, account: 'murqart@gmail.com' })),
      ...EXPORT_ADOBEVGC.map((name, idx) => ({ row: EXPORT_MURQART.length + idx + 1, name, account: 'adobevgc@gmail.com' }))
    ];

    const murqartUserRole = await base44.entities.Character.list('-updated_date', 500);
    const allCharsServiceRole = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const aliases = await base44.asServiceRole.entities.CharacterAlias.list(null, 500).catch(() => []);

    const unmatched = [];
    const misplaced = [];

    for (const exportRow of exportRows) {
      const { row, name, account } = exportRow;
      const userMatch = murqartUserRole.find(c => c.name === name);
      const serviceMatch = allCharsServiceRole.find(c => c.name === name);
      const aliasMatch = aliases.find(a => a.alias_name === name);

      if (userMatch) {
        if (account === 'adobevgc@gmail.com' && userMatch.created_by !== 'adobevgc@gmail.com') {
          misplaced.push({
            row, name, account,
            current_owner: userMatch.created_by,
            character_id: userMatch.id,
            character_type: userMatch.character_type,
          });
        }
      } else if (serviceMatch) {
        if (account === 'adobevgc@gmail.com' && serviceMatch.created_by !== 'adobevgc@gmail.com') {
          misplaced.push({
            row, name, account,
            current_owner: serviceMatch.created_by,
            character_id: serviceMatch.id,
            character_type: serviceMatch.character_type,
          });
        }
      } else if (!aliasMatch) {
        unmatched.push({ row, name, account });
      }
    }

    return Response.json({ unmatched, misplaced });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});