import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch Ethan Thompson directly
    const ethanId = '69c0d59d7e382cc866ded9c9';
    const ethanChars = await base44.entities.Character.filter({ id: ethanId });
    if (ethanChars.length === 0) {
      return Response.json({ error: 'Ethan Thompson not found', id: ethanId }, { status: 404 });
    }

    const ethan = ethanChars[0];
    const originalFamilyCount = (ethan.family_members || []).length;
    
    // Remove Jayden from family_members
    const updatedFamily = (ethan.family_members || []).filter(fm => 
      (fm.name || fm.person_name)?.toLowerCase().trim() !== 'jayden'
    );

    const removedCount = originalFamilyCount - updatedFamily.length;

    // Update the character
    await base44.entities.Character.update(ethanId, {
      family_members: updatedFamily
    });

    return Response.json({
      character: ethan.name,
      character_id: ethanId,
      action: 'removed_jayden_from_family',
      family_members_before: originalFamilyCount,
      family_members_after: updatedFamily.length,
      jayden_entries_removed: removedCount,
      note: 'Jayden is the user and only a family member of Melody Jackson Perry, not Ethan Thompson',
      success: true
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});