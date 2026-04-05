import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, attemptedMemberName, attemptedRelationType } = await req.json();
    
    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Fetch the character
    const character = await base44.entities.Character.filter({ id: characterId });
    if (!character || character.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const char = character[0];

    // CRITICAL: Check if family list is LOCKED
    if (char.family_list_locked) {
      return Response.json({
        blocked: true,
        reason: 'FAMILY_LIST_LOCKED',
        message: 'This character\'s family list is locked. No changes allowed without user approval.',
      });
    }

    // Check for duplicates within existing family members
    const normalized = (attemptedMemberName || '').toLowerCase().trim();
    const existingFamilyNames = (char.family_members || []).map(fm => (fm.name || '').toLowerCase().trim());
    
    const isDuplicate = existingFamilyNames.includes(normalized);

    if (isDuplicate) {
      const matchingMember = char.family_members.find(fm => (fm.name || '').toLowerCase().trim() === normalized);
      return Response.json({
        blocked: true,
        reason: 'DUPLICATE_DETECTED',
        message: `This person ("${attemptedMemberName}") is already listed as a family member.`,
        existingMember: matchingMember,
        suggestion: 'This entry is a duplicate. Discard it or check if it\'s an alias for the existing member.',
      });
    }

    // No issues — proceed
    return Response.json({
      blocked: false,
      approved: true,
      message: 'Ready to add to family list.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});