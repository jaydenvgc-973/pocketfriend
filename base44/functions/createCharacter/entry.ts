import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Only authenticated users can create
    if (!user || !user.email) {
      return Response.json({ error: 'Unauthorized: User must be authenticated' }, { status: 401 });
    }

    const { characterData } = await req.json();

    // Validate owner_email is not blank
    if (!characterData.owner_email || characterData.owner_email.trim() === '') {
      return Response.json({ error: 'owner_email is required' }, { status: 400 });
    }

    // Auto-set owner_email and created_by to current user's email
    const dataToCreate = {
      ...characterData,
      owner_email: user.email,
      created_by: user.email,
    };

    // Normalize owner_email to lowercase
    dataToCreate.owner_email = dataToCreate.owner_email.toLowerCase();

    const character = await base44.entities.Character.create(dataToCreate);

    return Response.json({ success: true, character });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});