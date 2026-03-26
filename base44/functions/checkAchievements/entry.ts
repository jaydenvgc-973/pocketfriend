import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Achievement detection logic — returns array of achievement_ids to unlock
function detectAchievements(userMessage, characterState, existingAchievementIds) {
  const msg = (userMessage || '').toLowerCase();
  const toUnlock = [];

  // Helper: already unlocked?
  const alreadyUnlocked = (id) => existingAchievementIds.includes(id);

  // --- first_impression: already handled elsewhere but just in case ---

  // --- Care / Support achievements ---

  // first_responder: arranged help / called someone / got an uber / took action
  if (!alreadyUnlocked('first_responder')) {
    const firstResponderPatterns = [
      /call(ed|ing)?\s+(9-?1-?1|emergency|ambulance|paramedic|help)/i,
      /order(ed|ing)?\s+(an?\s+)?(uber|lyft|taxi|cab|ride)/i,
      /call(ed|ing)?\s+(her|his|their|your)?\s*(mom|dad|mother|father|parent|sister|brother|family|boyfriend|girlfriend|partner|friend)/i,
      /contact(ed|ing)?\s+(someone|her|his|their)/i,
      /reach(ed|ing)?\s+out\s+to/i,
      /got\s+(her|him|them)\s+(help|a ride|an uber|checked)/i,
      /mak(e|ing|ing sure)\s+(sure|it)\s+(she|he|they)\s*(is|was|gets|got)/i,
      /took\s+(her|him|them)\s+to\s+(the\s+)?(hospital|doctor|urgent care|er|emergency)/i,
      /drove\s+(her|him|them)/i,
      /pick(ed|ing)?\s+(her|him|them)\s+up/i,
      /arranged\s+/i,
      /set\s+up\s+/i,
      /made\s+(the\s+)?call/i,
    ];
    if (firstResponderPatterns.some(p => p.test(msg))) {
      toUnlock.push('first_responder');
    }
  }

  // bedside_manner: stayed with / checked in during health crisis
  if (!alreadyUnlocked('bedside_manner')) {
    const bedsidePatterns = [
      /how\s+are\s+you\s+(feeling|doing)/i,
      /are\s+you\s+(ok|okay|alright|feeling better|doing better)/i,
      /checking\s+(in|on\s+you)/i,
      /check(ed|ing)?\s+on\s+(her|him|them|you)/i,
      /still\s+(with\s+you|here|thinking)/i,
      /hope\s+you('re|\s+are)\s+(ok|okay|feeling|better|recovering)/i,
      /get\s+well/i,
      /feel\s+better/i,
      /thinking\s+(of|about)\s+you/i,
      /praying\s+for/i,
      /sending\s+(love|thoughts|prayers|good vibes)/i,
      /let\s+me\s+know\s+(if|how)/i,
      /i('m|\s+am)\s+here\s+(for\s+you|if)/i,
      /stay(ed|ing)?\s+(with|by)\s+(her|him|them|you)/i,
    ];
    if (bedsidePatterns.some(p => p.test(msg))) {
      toUnlock.push('bedside_manner');
    }
  }

  // the_call_nobody_wanted: specifically contacted family/partner on character's behalf
  if (!alreadyUnlocked('the_call_nobody_wanted')) {
    const hardCallPatterns = [
      /call(ed|ing)?\s+(her|his|their|your)?\s*(mom|dad|mother|father|parent|sister|brother|family|boyfriend|girlfriend|partner)/i,
      /text(ed|ing)?\s+(her|his|their|your)?\s*(mom|dad|mother|father|parent|sister|brother|family|boyfriend|girlfriend|partner)/i,
      /told\s+(her|his|their|your)?\s*(mom|dad|mother|father|parent|sister|brother|family|boyfriend|girlfriend|partner)/i,
      /reach(ed|ing)?\s+out\s+to\s+(her|his|their|your)?\s*(mom|dad|mother|father|parent|family)/i,
      /let\s+(her|his|their|your)?\s*(mom|dad|mother|father|parent|family|partner|boyfriend|girlfriend)\s+know/i,
      /notif(ied|ying)\s+(her|his|their|your)?\s*(mom|dad|mother|father|parent|family)/i,
      /informed\s+(her|his|their|your)?\s*(family|mom|dad|parent)/i,
    ];
    if (hardCallPatterns.some(p => p.test(msg))) {
      toUnlock.push('the_call_nobody_wanted');
    }
  }

  return toUnlock;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, characterName, userMessage } = await req.json();
    if (!characterId || !userMessage) {
      return Response.json({ unlocked: [] });
    }

    // Get existing achievements so we don't double-unlock
    const existing = await base44.asServiceRole.entities.UserAchievement.filter({
      created_by: user.email,
    });
    const existingIds = existing.map(a => a.achievement_id);

    const toUnlock = detectAchievements(userMessage, {}, existingIds);

    const newlyUnlocked = [];
    for (const achievement_id of toUnlock) {
      const record = await base44.asServiceRole.entities.UserAchievement.create({
        achievement_id,
        character_id: characterId,
        character_name: characterName || '',
        unlocked_at: new Date().toISOString(),
        tier: 'bronze',
        is_seen: false,
      });
      newlyUnlocked.push(record);
    }

    return Response.json({ unlocked: newlyUnlocked });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});