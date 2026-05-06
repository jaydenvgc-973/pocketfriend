import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Reassign all specified characters from adobevgc@gmail.com to murqart@gmail.com
 * This is a one-time correction for characters that were created with wrong ownership.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Characters that need ownership correction
    const characterNames = [
      'Amelia Johnson', 'Briar Kieran', 'Jasmine Rodriguez', 'Nick Decker',
      'Sofia Garcia', 'Terrance Gibbons', 'Tim',
      'Abuela Sophia', 'Camila', 'Daniela', 'Javier', 'Kiara', 'Larry',
      'Marisol', 'Michael', 'Nancy', 'Sarah', 'Stephanie', 'Udelka', 'Vanessa'
    ];

    // Fetch all characters that currently belong to adobevgc but match these names
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: 'adobevgc@gmail.com' },
      'created_date',
      300
    );

    const toUpdate = allChars.filter(c => characterNames.includes(c.name));

    const results = [];
    for (const char of toUpdate) {
      try {
        await base44.asServiceRole.entities.Character.update(char.id, {
          owner_email: 'murqart@gmail.com',
        });
        results.push({ id: char.id, name: char.name, status: 'updated' });
      } catch (err) {
        results.push({ id: char.id, name: char.name, status: 'error', error: err.message });
      }
    }

    console.log(`[fixMurqartCharacterOwnership] Updated ${toUpdate.length} characters from adobevgc to murqart`);

    return Response.json({
      success: true,
      updated_count: toUpdate.length,
      results,
    });
  } catch (error) {
    console.error('[fixMurqartCharacterOwnership]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});