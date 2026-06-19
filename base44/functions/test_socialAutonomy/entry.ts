import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }

    const characters = await base44.entities.Character.filter({ id: characterId });
    if (!characters.length) {
        return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    const character = characters[0]

    const contact = character.fictional_relationships?.[0]?.person_name || character.family_members?.[0]?.name;
    if (contact) {
        const result = await base44.functions.invoke('triggerCharacterContact', { senderCharacterId: character.id, receiverCharacterName: contact, topic: 'Checking in', trigger_source: 'need_driven', autonomy_marker: 'AUTONOMOUS_SOCIAL_ACTION_V1' });
        return Response.json({ success: true, contact_triggered: true, contact_name: contact, result: result.data });
    }

    return Response.json({ success: true, contact_triggered: false });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});