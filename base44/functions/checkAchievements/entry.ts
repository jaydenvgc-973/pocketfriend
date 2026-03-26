import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Achievement detection logic — returns array of achievement_ids to unlock
function detectAchievements(userMessage, characterState, existingAchievementIds) {
  const msg = (userMessage || '').toLowerCase();
  const toUnlock = [];

  // Helper: already unlocked?
  const alreadyUnlocked = (id) => existingAchievementIds.includes(id);

  // Helper: is character in an unhealthy/crisis state?
  const healthStatus = (characterState.health_status || '').toLowerCase();
  const isUnhealthy = healthStatus && !['healthy', 'good', 'fine', 'great', ''].includes(healthStatus);

  // Helper: is character currently not enrolled in education?
  const currentEdu = (characterState.current_education_activity || 'none').toLowerCase();
  const notInEducation = currentEdu === 'none' || currentEdu === '';

  // --- Care / Support achievements ---

  // first_responder: arranged help / called someone / got an uber / took action
  // Triggered more broadly (with or without health crisis) OR specifically when health crisis + medical action
  if (!alreadyUnlocked('first_responder')) {
    const firstResponderPatterns = [
      /call(ed|ing)?\s+(9-?1-?1|emergency|ambulance|paramedic|help)/i,
      /order(ed|ing)?\s+(an?\s+)?(uber|lyft|taxi|cab|ride)/i,
      /call(ed|ing)?\s+(her|his|their|your)?\s*(mom|dad|mother|father|parent|sister|brother|family|boyfriend|girlfriend|partner|friend)/i,
      /contact(ed|ing)?\s+(someone|her|his|their)/i,
      /reach(ed|ing)?\s+out\s+to/i,
      /got\s+(her|him|them)\s+(help|a ride|an uber|checked)/i,
      /mak(e|ing|ing sure)\s+(sure|it)\s+(she|he|they)\s*(is|was|gets|got)/i,
      /took\s+(her|him|them)\s+to\s+(the\s+)?(hospital|doctor|urgent care|er|emergency|clinic)/i,
      /drove\s+(her|him|them)/i,
      /pick(ed|ing)?\s+(her|him|them)\s+up/i,
      /arranged\s+/i,
      /set\s+up\s+/i,
      /made\s+(the\s+)?call/i,
      // Health/clinic specific — catches "sending hospitals list", "found a clinic", "list of hospitals"
      /list\s+of\s+(hospitals|clinics|doctors|urgent care)/i,
      /found\s+(a\s+)?(hospital|clinic|doctor|urgent care|er)/i,
      /sent\s+(you\s+)?(a\s+)?(list|info|details|address|location)\s+(of|for|about)?\s*(hospital|clinic|doctor)/i,
      /here\s+(are|is)\s+(some\s+)?(hospitals|clinics|doctors|options|places)/i,
      /near(by)?\s+(hospital|clinic|doctor|urgent care)/i,
      /go\s+(to\s+)?(the\s+)?(hospital|clinic|doctor|urgent care|er)/i,
      /get\s+(yourself\s+)?(checked|tested|seen|treated|help)/i,
      /talk(ed|ing)?\s+(her|him|them|you)?\s*(into|to)\s*(get|getting|go|going)\s*(tested|checked|seen|help|treatment)/i,
      /convinced?\s+(her|him|them|you)?\s*(to\s+)?(get|go)\s*(tested|checked|seen|help|treatment)/i,
    ];
    // Fire for direct emergency action always, OR for medical/clinic actions during health crisis
    const isEmergencyAction = firstResponderPatterns.slice(0, 9).some(p => p.test(msg));
    const isMedicalSupport = firstResponderPatterns.slice(9).some(p => p.test(msg));
    if (isEmergencyAction || isMedicalSupport) {
      toUnlock.push('first_responder');
    }
  }

  // bedside_manner: checked in / showed care — more valuable during health crisis
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
      // Clinic / testing support
      /talk(ed|ing)?\s+(her|him|them|you)?\s*(into|to)\s*(get|getting|go|going)\s*(tested|checked|screened)/i,
      /convinced?\s+(her|him|them|you)?\s*(to\s+)?(get|go)\s*(tested|checked|screened)/i,
      /go(t|ing)?\s+(to\s+)?(the\s+)?(clinic|doctor|appointment|checkup|check-up)/i,
      /make\s+(an?\s+)?appointment/i,
      /scheduled?\s+(an?\s+)?(appointment|checkup|test|screening)/i,
    ];
    // Bedside manner fires always when these care patterns match — health crisis makes it more meaningful but isn't required
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

  // --- Influence / Personal Growth achievements ---

  // the_push: talked character into taking action on their future (education, career, self-improvement)
  if (!alreadyUnlocked('the_push')) {
    const thePushPatterns = [
      /talk(ed|ing)?\s+(her|him|them|you)?\s*(into|to)\s*(tak(e|ing)|enroll(ing)?|sign(ing)?\s+up|start(ing)?|pursu(e|ing)?)\s*(a\s+)?(course|class|certification|degree|program|training)/i,
      /convinced?\s+(her|him|them|you)?\s*(to\s+)?(tak(e|ing)|enroll(ing)?|sign(ing)?\s+up|start(ing)?)\s*(a\s+)?(course|class|certification|degree|program|training)/i,
      /should\s+(take|enroll|sign up|try|do|start)\s+(a\s+)?(course|class|certification|degree|program|training)/i,
      /enroll(ed|ing)?\s+(in|for)\s+(a\s+)?(course|class|certification|program|training)/i,
      /sign(ed|ing)?\s+up\s+(for|in)\s+(a\s+)?(course|class|certification|program|training)/i,
      /register(ed|ing)?\s+(for|in)\s+(a\s+)?(course|class|certification|program|training)/i,
      /start(ed|ing)?\s+(a\s+)?(course|class|certification|program|training|school|college)/i,
      /go(ing)?\s+(back\s+to\s+)?(school|college|university|class)/i,
      /get\s+(your|a)\s+(degree|certification|diploma|license|certificate)/i,
      /you\s+should\s+(go\s+back|pursue|consider|look\s+into)\s+(school|education|college|training)/i,
    ];
    if (thePushPatterns.some(p => p.test(msg))) {
      toUnlock.push('the_push');
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