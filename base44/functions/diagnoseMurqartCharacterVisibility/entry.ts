import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'murqart@gmail.com';

    // Find all characters created by murqart@gmail.com
    const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 500);
    const createdByMurqart = allChars.filter(c => c.created_by === targetEmail);
    
    // Separate by owner_email status
    const withoutOwnerEmail = createdByMurqart.filter(c => !c.owner_email || c.owner_email.trim() === '');
    const withWrongOwnerEmail = createdByMurqart.filter(c => c.owner_email && c.owner_email !== targetEmail);
    const withCorrectOwnerEmail = createdByMurqart.filter(c => c.owner_email === targetEmail);

    return Response.json({
      targetEmail,
      stats: {
        total_created_by_murqart: createdByMurqart.length,
        with_correct_owner_email: withCorrectOwnerEmail.length,
        without_owner_email: withoutOwnerEmail.length,
        with_wrong_owner_email: withWrongOwnerEmail.length,
      },
      characters_needing_repair: {
        missing_owner_email: withoutOwnerEmail.map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })).slice(0, 10),
        wrong_owner_email: withWrongOwnerEmail.map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })).slice(0, 10),
      },
      correct_characters: withCorrectOwnerEmail.map(c => ({ id: c.id, name: c.name })).slice(0, 10),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});