import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Removes temporary NPCs from all characters' fictional_relationships.
 * Called after a scene ends to clean up generic staff/role NPCs.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterIds } = await req.json().catch(() => ({}));
    
    // Fetch all active characters (or specific ones if provided)
    const query = characterIds?.length > 0 
      ? { id: { "$in": characterIds }, status: "active" }
      : { status: "active" };
    const characters = await base44.entities.Character.filter(query);
    
    let npcsCleaned = 0;
    
    // Remove temporary NPCs from each character's relationships
    await Promise.all(characters.map(async (char) => {
      const relationships = char.fictional_relationships || [];
      const filtered = relationships.filter(rel => !isTemporaryNPC(rel));
      
      if (filtered.length < relationships.length) {
        npcsCleaned += relationships.length - filtered.length;
        await base44.entities.Character.update(char.id, {
          fictional_relationships: filtered
        }).catch(err => console.error(`Failed to clean ${char.name}:`, err));
      }
    }));
    
    return Response.json({
      success: true,
      npcsCleaned,
      charactersProcessed: characters.length,
    });
  } catch (error) {
    console.error('Cleanup failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Check if an NPC is temporary (title-only, generic).
 */
function isTemporaryNPC(npc) {
  if (!npc || !npc.person_name) return false;
  
  const titles = new Set([
    'bartender', 'waiter', 'server', 'host', 'hostess',
    'barkeep', 'bartend', 'cashier', 'clerk', 'staff',
    'manager', 'supervisor', 'coworker', 'colleague',
    'trainer', 'instructor', 'coach',
    'bouncer', 'security', 'guard', 'attendant',
    'customer', 'patron', 'shopper', 'diner',
    'nurse', 'doctor', 'receptionist', 'assistant',
    'guy', 'girl', 'woman', 'man', 'person',
    'local', 'stranger', 'passerby', 'jogger', 'walker'
  ]);
  
  const normalized = npc.person_name.toLowerCase().trim();
  
  if (titles.has(normalized)) return true;
  if (normalized.startsWith('the ') && titles.has(normalized.substring(4).trim())) return true;
  if (titles.has(normalized.split(' ')[0])) return true;
  
  return false;
}