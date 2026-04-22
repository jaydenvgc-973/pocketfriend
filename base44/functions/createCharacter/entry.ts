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

    if (!characterData?.name?.trim()) {
      return Response.json({ error: 'Character name is required' }, { status: 400 });
    }

    // STRICT: owner_email and owner_user_id always come from the authenticated session.
    // Never trust or use caller-supplied ownership fields.
    const dataToCreate = {
      ...characterData,
      owner_email: user.email.toLowerCase(),
      owner_user_id: user.id,
      // created_by is set automatically by the platform but we set it here for audit clarity
    };

    const character = await base44.entities.Character.create(dataToCreate);

    return Response.json({ success: true, character });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});