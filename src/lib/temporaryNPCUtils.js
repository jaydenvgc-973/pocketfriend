/**
 * Identifies temporary/title-only NPCs that should not persist.
 * These are generic staff/role NPCs without real identity.
 */
const TEMPORARY_NPC_TITLES = new Set([
  'bartender', 'waiter', 'server', 'host', 'hostess',
  'barkeep', 'bartend', 'cashier', 'clerk', 'staff',
  'manager', 'supervisor', 'coworker', 'colleague',
  'trainer', 'instructor', 'coach', 'trainer',
  'bouncer', 'security', 'guard', 'attendant',
  'customer', 'patron', 'shopper', 'diner',
  'nurse', 'doctor', 'receptionist', 'assistant',
  'guy', 'girl', 'woman', 'man', 'person',
  'local', 'stranger', 'passerby', 'jogger', 'walker'
]);

/**
 * Check if an NPC is temporary (title-only, generic).
 * Returns true if the name matches a generic title.
 */
export function isTemporaryNPC(npc) {
  if (!npc || !npc.person_name) return false;
  
  const normalized = npc.person_name.toLowerCase().trim();
  
  // If it's an exact match to a title
  if (TEMPORARY_NPC_TITLES.has(normalized)) return true;
  
  // If it's "the [title]" (e.g., "the bartender", "the waiter")
  if (normalized.startsWith('the ')) {
    const title = normalized.substring(4).trim();
    if (TEMPORARY_NPC_TITLES.has(title)) return true;
  }
  
  // If it's "[title] at [place]" or similar
  if (TEMPORARY_NPC_TITLES.has(normalized.split(' ')[0])) {
    return true;
  }
  
  return false;
}

/**
 * Filter out temporary NPCs from a list of characters/NPCs.
 */
export function filterOutTemporaryNPCs(items) {
  return (items || []).filter(item => !isTemporaryNPC(item));
}