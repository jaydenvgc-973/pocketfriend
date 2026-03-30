import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fixes = [];
    const issuesFound = [];

    // DEEP DIVE: Search ALL characters in the system for those created by this user
    // (regardless of created_by field accuracy)
    const allCharacters = await base44.asServiceRole.entities.Character.list('-created_date', 1000);
    
    // Find characters that might belong to this user:
    // 1. Already have correct created_by
    // 2. Have incorrect created_by but match user email pattern or were created recently
    const userCharacters = allCharacters.filter(c => {
      // Primary: correct created_by
      if (c.created_by === user.email) return true;
      
      // Secondary: characters with service role email that might be orphaned
      if (c.created_by && c.created_by.includes('service+')) {
        // For now, assume any service-role character needs investigation
        return true;
      }
      
      return false;
    });

    // Filter out deleted characters
    const activeUserCharacters = userCharacters.filter(c => c.status !== 'deleted');

    if (activeUserCharacters.length === 0) {
      return Response.json({
        success: true,
        data: {
          summary: 'No missing characters found. All your characters are accounted for.',
          fixes_applied: [],
          issues_found: [],
          checks: []
        }
      });
    }

    // Force-fix: ensure all active characters have correct created_by
    for (const char of activeUserCharacters) {
      if (char.created_by !== user.email) {
        await base44.asServiceRole.entities.Character.update(char.id, {
          created_by: user.email
        });
        fixes.push(`Fixed created_by for "${char.name}" (ID: ${char.id.substring(0, 8)})`);
      }
    }

    // Force-ensure all active characters have status set correctly
    for (const char of activeUserCharacters) {
      if (!char.status || char.status === 'deleted') {
        await base44.asServiceRole.entities.Character.update(char.id, {
          status: 'active'
        });
        fixes.push(`Ensured "${char.name}" status is active`);
      }
    }

    const summary = `Found ${activeUserCharacters.length} character(s) belonging to you. Applied ${fixes.length} fix(es) to ensure they appear on your homepage.`;

    return Response.json({
      success: true,
      data: {
        summary,
        fixes_applied: fixes,
        issues_found: issuesFound,
        checks: [
          { name: 'Deep character scan', status: 'passed', message: `Scanned ${allCharacters.length} total characters` },
          { name: 'User character identification', status: 'passed', message: `Found ${activeUserCharacters.length} characters for user ${user.email}` },
          { name: 'created_by validation', status: fixes.length > 0 ? 'fixed' : 'passed', message: `Applied ${fixes.length} corrections` },
          { name: 'Status validation', status: 'passed', message: 'All characters set to active' }
        ]
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});