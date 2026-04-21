import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = user.email;
    const diagnostic = {
      timestamp: new Date().toISOString(),
      userEmail,
      userId: user.id,
      results: {}
    };

    // ════════════════════════════════════════════════════════════════
    // STEP 1: Fetch ALL characters by both created_by and owner_email
    // ════════════════════════════════════════════════════════════════
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.entities.Character.filter({ created_by: userEmail }, '-created_date', 500),
      base44.entities.Character.filter({ owner_email: userEmail }, '-created_date', 500),
    ]);

    diagnostic.results.rawFetches = {
      byCreatedBy: byCreatedBy.length,
      byOwnerEmail: byOwnerEmail.length,
    };

    // ════════════════════════════════════════════════════════════════
    // STEP 2: Merge and deduplicate
    // ════════════════════════════════════════════════════════════════
    const seen = new Set();
    const allChars = [...byCreatedBy, ...byOwnerEmail].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    diagnostic.results.mergedTotal = allChars.length;

    // ════════════════════════════════════════════════════════════════
    // STEP 3: Break down by character_type
    // ════════════════════════════════════════════════════════════════
    const typeBreakdown = {};
    const npcFictitious = [];
    
    allChars.forEach(c => {
      const type = c.character_type || 'undefined';
      typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
      
      if (type === 'npc_fictitious') {
        npcFictitious.push({
          id: c.id,
          name: c.name,
          status: c.status,
          is_default: c.is_default,
          protected_active: c.protected_active,
          created_by: c.created_by,
          owner_email: c.owner_email,
        });
      }
    });

    diagnostic.results.typeBreakdown = typeBreakdown;
    diagnostic.results.npcFictitious = {
      count: npcFictitious.length,
      characters: npcFictitious,
    };

    // ════════════════════════════════════════════════════════════════
    // STEP 4: Apply NPCContactPanel filtering logic
    // ════════════════════════════════════════════════════════════════
    const filtered = allChars
      .filter(c => {
        if (c.protected_active) return false;
        if (c.character_type === 'active_created_character') return false;
        if (c.is_default) return false;
        return true;
      });

    diagnostic.results.afterFiltering = {
      count: filtered.count,
      characters: filtered.map(c => ({
        id: c.id,
        name: c.name,
        character_type: c.character_type,
      })),
    };

    // ════════════════════════════════════════════════════════════════
    // STEP 5: Check if npc_fictitious characters are being filtered out
    // ════════════════════════════════════════════════════════════════
    const npcFicticiousFiltered = npcFictitious.filter(c => {
      const fullChar = allChars.find(ch => ch.id === c.id);
      if (fullChar.protected_active) return false;
      if (fullChar.character_type === 'active_created_character') return false;
      if (fullChar.is_default) return false;
      return true;
    });

    diagnostic.results.npcFicticiousFiltered = {
      count: npcFicticiousFiltered.length,
      characters: npcFicticiousFiltered,
    };

    // ════════════════════════════════════════════════════════════════
    // STEP 6: Check if npc_fictitious characters even exist
    // ════════════════════════════════════════════════════════════════
    if (npcFictitious.length === 0) {
      // Query directly for any npc_fictitious globally to understand if they're in the system
      const allNpcFictitious = await base44.entities.Character.filter({ character_type: 'npc_fictitious' }, '-created_date', 100);
      diagnostic.results.globalNpcFictitious = {
        count: allNpcFictitious.length,
        note: 'Total npc_fictitious characters in the entire system',
      };
    }

    return Response.json({ success: true, diagnostic });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});