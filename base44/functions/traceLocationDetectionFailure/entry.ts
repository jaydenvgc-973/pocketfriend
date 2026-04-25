import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizePhrase(p) {
  return p.toLowerCase().trim()
    .replace(/['".,!?]/g, '')
    .replace(/\bthe\b\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PLACE_PATTERNS = [
  /\b(?:i'm at|i am at|i'm in|currently at|just got to|heading to(?:\s+the)?|at the|going to the|going to|at my|made it to|just pulled up to|arrived at)\s+([\w\s'']+?)(?=\s+to\s+(?:see|check|find|meet|get|grab|pick)|[,.]|\s+(?:so|and|but|because|since|where|who|with|for)\b|$)/i,
  /\b(?:i'm|i am)\s+(?:at|in)\s+(?:the\s+)?([\w\s'']+?)(?=\s+to\s+(?:see|check|find|meet|get)|[,.]|\s+(?:so|and|but|because|since|where|who|with)\b|$)/i,
];

const VAGUE = ['out', 'busy', 'gone', 'away', 'around', 'somewhere', 'good', 'here'];

const RABBIT_HOLE_TERMS = new Set([
  'studio', 'rehearsal', 'set', 'backstage', 'session', 'recording session',
  'appointment', 'class', 'interview', 'court', 'warehouse', 'venue',
  'stage', 'rooftop', 'gallery', 'lab', 'salon', 'clinic',
]);

function detectSpokenPlace(msg) {
  const lower = msg.toLowerCase();
  if (VAGUE.some(v => lower === v || lower === `i'm ${v}`)) return null;

  for (const pattern of PLACE_PATTERNS) {
    const m = msg.match(pattern);
    if (m && m[1]) {
      const raw = m[1].trim();
      if (raw.length < 2 || VAGUE.includes(raw.toLowerCase())) continue;
      return { raw, normalized: normalizePhrase(raw) };
    }
  }

  for (const term of RABBIT_HOLE_TERMS) {
    if (lower.includes(term)) {
      return { raw: term, normalized: term };
    }
  }

  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // The exact messages the characters sent
    const testMessages = [
      { char: 'Ethan', msg: "I'm out the door. Grabbing my keys and heading to the bar to see how much of a wreck James really is right now." },
      { char: 'Brian', msg: "If it was really the 14th, then I've been out of it for way longer than I thought. I'm gonna see if Mace is around because sitting in this house is just not cutting it." },
      { char: 'Andre', msg: "I ended up gutting my kitchen pantry because the mess was starting to feel like a personal insult." },
    ];

    // Fetch all locations to test matching
    const locRes = await base44.entities.LocationReference.filter({ created_by: user.email }, null, 100);
    const locations = locRes || [];

    const results = [];

    for (const test of testMessages) {
      const detected = detectSpokenPlace(test.msg);
      
      let locationMatch = null;
      if (detected) {
        for (const loc of locations) {
          const locNorm = normalizePhrase(loc.name);
          const kws = (loc.keywords || []).map(k => normalizePhrase(k));
          if (locNorm === detected.normalized || kws.includes(detected.normalized)) {
            locationMatch = loc.name;
            break;
          }
          if (test.msg.toLowerCase().includes(loc.name.toLowerCase()) && loc.name.length > 4) {
            locationMatch = loc.name + ' (partial)';
            break;
          }
        }
      }

      results.push({
        character: test.char,
        message: test.msg,
        detected,
        locationMatch,
        patternTests: PLACE_PATTERNS.map((p, i) => {
          const m = test.msg.match(p);
          return { pattern: i + 1, matched: !!m, capture: m?.[1] };
        }),
      });
    }

    return Response.json({ results, locationCount: locations.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});