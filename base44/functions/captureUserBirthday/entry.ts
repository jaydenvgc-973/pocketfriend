/**
 * captureUserBirthday
 *
 * Detects and durably stores the user's birthday from any source
 * (chat message, profile, settings, onboarding).
 *
 * Writes to CharacterMemory (Life Journal) as a protected hard fact.
 * All characters belonging to this user's account inherit access.
 *
 * Storage schema:
 *   character_id:    <characterId who heard it> — so retrieval is scoped correctly
 *   memory_type:     "fact"
 *   memory_text:     canonical birthday fact string
 *   memory_summary:  ISO date string (YYYY-MM-DD or MM-DD)
 *   importance_score: 10 (maximum — this is a permanent continuity fact)
 *   permanence:      "protected"
 *   validation_status: "confirmed"
 *   fact_type:       "user_birthday"   (custom field stored in memory_text JSON preamble)
 *   source:          where the birthday was detected (chat/profile/settings/onboarding)
 *
 * Deduplication: only one user_birthday record per account. If a correction is detected,
 * the existing record is updated and a correction_history entry is appended.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── BIRTHDAY PARSER ────────────────────────────────────────────────────────────
// Returns { raw: string, normalized: string | null } where normalized is YYYY-MM-DD or MM-DD
function parseBirthday(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();

  // ISO / numeric formats: YYYY-MM-DD or M/D/YYYY or M-D-YYYY
  const isoMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return { raw: s, normalized: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, hasYear: true };
  }

  const mdyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const fullYear = y.length === 2 ? `19${y}` : y;
    return { raw: s, normalized: `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, hasYear: true };
  }

  // Month name formats: "January 5", "Jan 5 1990", "5th of January", "March 12, 1985"
  const monthNames = {
    jan: '01', january: '01', feb: '02', february: '02',
    mar: '03', march: '03', apr: '04', april: '04',
    may: '05', jun: '06', june: '06', jul: '07', july: '07',
    aug: '08', august: '08', sep: '09', sept: '09', september: '09',
    oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
  };

  const monthNameMatch = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)(?:\s+(\d{2,4}))?/i)
    || s.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{2,4}))?/i);

  if (monthNameMatch) {
    let day, monthStr, year;
    if (/^\d/.test(monthNameMatch[1])) {
      // day-month-year
      day = monthNameMatch[1];
      monthStr = monthNameMatch[2];
      year = monthNameMatch[3];
    } else {
      // month-day-year
      monthStr = monthNameMatch[1];
      day = monthNameMatch[2];
      year = monthNameMatch[3];
    }
    const monthNum = monthNames[monthStr.toLowerCase()];
    if (monthNum) {
      const hasYear = !!year;
      const fullYear = year ? (year.length === 2 ? `19${year}` : year) : null;
      const normalized = fullYear
        ? `${fullYear}-${monthNum}-${day.padStart(2, '0')}`
        : `${monthNum}-${day.padStart(2, '0')}`;
      return { raw: s, normalized, hasYear };
    }
  }

  return null;
}

// ── BIRTHDAY STATEMENT DETECTOR ───────────────────────────────────────────────
// Detects birthday-revealing statements in natural chat text.
// Returns { found: bool, rawDateStr: string | null, confidence: number }
function detectBirthdayStatement(text) {
  if (!text || typeof text !== 'string') return { found: false };

  const t = text.trim();
  const lower = t.toLowerCase();

  // High-confidence direct statements
  const directPatterns = [
    // "my birthday is [date]"
    /my birthday (?:is|was|'s|falls on|will be)[^\.\n]*?(\w[\w\s\/\-,]+\w|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    // "I was born on [date]" / "I was born in [month year]"
    /i was born (?:on|in)[^\.\n]*?(\w[\w\s\/\-,]+\w|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    // "I turn [age] on [date]"
    /i(?:'m| am)? turning \d+ (?:on|this)[^\.\n]*?(\w[\w\s\/\-,]+\w|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    // "I turn [age] in [month]" 
    /i turn \d+ in (\w+ \d{4}|\w+)/i,
    // "born on [date]" (without "I was")
    /\bborn (?:on|the) (\w[\w\s\/\-,]+\w|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    // "my DOB is [date]" / "my date of birth is [date]"
    /(?:my )?(?:dob|date of birth|birth date) (?:is|was|:)[^\.\n]*?(\w[\w\s\/\-,]+\w|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    // "I celebrate my birthday on [date]"
    /(?:celebrate|celebrated) my birthday (?:on|every)[^\.\n]*?(\w[\w\s\/\-,]+\w)/i,
    // "my bday is [date]"
    /my (?:bday|b-day) (?:is|was|'s)[^\.\n]*?(\w[\w\s\/\-,]+\w|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    // "[date] is my birthday"
    /(\w[\w\s\/\-,]+\w|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?) is my birthday/i,
  ];

  for (const pattern of directPatterns) {
    const m = t.match(pattern);
    if (m && m[1]) {
      const parsed = parseBirthday(m[1]);
      if (parsed) {
        return { found: true, rawDateStr: m[1], parsed, confidence: 0.95 };
      }
    }
  }

  // Medium-confidence: pure date strings after birthday keywords nearby
  const birthdayKeywords = /\b(birthday|born|birth|bday)\b/i;
  const datePatterns = [
    /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/,
    /\b(\d{1,2})[\/\-](\d{1,2})\b/,
    /((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:\s*[,\/]\s*\d{2,4})?)/i,
  ];

  if (birthdayKeywords.test(lower)) {
    for (const dp of datePatterns) {
      const dm = t.match(dp);
      if (dm) {
        const parsed = parseBirthday(dm[0]);
        if (parsed) {
          return { found: true, rawDateStr: dm[0], parsed, confidence: 0.75 };
        }
      }
    }
  }

  return { found: false };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      characterId,      // which character heard/prompted the birthday disclosure
      text,             // raw text to scan (chat message, profile field value, etc.)
      source = 'chat',  // 'chat' | 'profile' | 'settings' | 'onboarding' | 'direct'
      directDate,       // if provided, bypass detection and store this date directly
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    let detection;

    if (directDate) {
      // Direct write from profile/settings — bypass NLP detection
      const parsed = parseBirthday(directDate);
      if (!parsed) {
        return Response.json({ found: false, reason: 'Could not parse directDate format' });
      }
      detection = { found: true, rawDateStr: directDate, parsed, confidence: 1.0 };
    } else if (text) {
      detection = detectBirthdayStatement(text);
    } else {
      return Response.json({ found: false, reason: 'No text or directDate provided' });
    }

    if (!detection.found || !detection.parsed) {
      return Response.json({ found: false });
    }

    const { normalized: normalizedDate, hasYear, raw: rawDateStr } = detection.parsed;
    const confidence = detection.confidence ?? 0.9;

    // ── CHECK FOR EXISTING USER BIRTHDAY RECORD ───────────────────────────────
    // Scope: ALL characters on this account — birthday is a user-level fact.
    // We search CharacterMemory records owned by this user that have fact_type=user_birthday.
    const existingList = await base44.asServiceRole.entities.CharacterMemory.filter(
      { character_id: characterId },
      '-created_date',
      50
    ).catch(() => []);

    // Birthday records are tagged with "FACT:user_birthday" in memory_text
    const existingBirthday = existingList.find(m =>
      m.memory_text && m.memory_text.includes('FACT:user_birthday')
    );

    const now = new Date().toISOString();
    const newMemoryText = `FACT:user_birthday | date:${normalizedDate} | hasYear:${!!hasYear} | raw:"${rawDateStr}" | source:${source} | confidence:${confidence} | captured:${now}`;
    const newMemorySummary = normalizedDate;

    if (existingBirthday) {
      // ── CORRECTION HANDLING ────────────────────────────────────────────────
      // Extract previous date from existing record
      const prevMatch = existingBirthday.memory_text?.match(/date:([^\s|]+)/);
      const prevDate = prevMatch ? prevMatch[1] : null;

      if (prevDate === normalizedDate) {
        // Same date — already stored, no-op
        console.log(`[captureUserBirthday] Birthday already stored: ${normalizedDate} | no update needed`);
        return Response.json({
          found: true,
          stored: false,
          reason: 'already_stored',
          date: normalizedDate,
          existingId: existingBirthday.id,
        });
      }

      // Date changed — update with correction history
      const correctionHistory = existingBirthday.memory_text?.match(/corrections:\[([^\]]*)\]/)?.[1] || '';
      const prevEntry = `{from:"${prevDate}",to:"${normalizedDate}",at:"${now}",source:"${source}"}`;
      const updatedCorrections = correctionHistory
        ? `${correctionHistory},${prevEntry}`
        : prevEntry;

      const updatedText = newMemoryText + ` | corrections:[${updatedCorrections}]`;

      await base44.asServiceRole.entities.CharacterMemory.update(existingBirthday.id, {
        memory_text: updatedText,
        memory_summary: newMemorySummary,
        importance_score: 10,
        permanence: 'protected',
        validation_status: 'confirmed',
        updated_date: now,
      });

      console.log(`[captureUserBirthday] Birthday UPDATED: ${prevDate} → ${normalizedDate} | source=${source} | charId=${characterId}`);

      return Response.json({
        found: true,
        stored: true,
        updated: true,
        date: normalizedDate,
        previousDate: prevDate,
        recordId: existingBirthday.id,
      });
    }

    // ── CREATE NEW BIRTHDAY RECORD ─────────────────────────────────────────────
    const newRecord = await base44.asServiceRole.entities.CharacterMemory.create({
      character_id: characterId,
      memory_type: 'fact',
      memory_text: newMemoryText,
      memory_summary: newMemorySummary,
      importance_score: 10,
      confidence_score: confidence,
      permanence: 'protected',
      validation_status: 'confirmed',
    });

    console.log(`[captureUserBirthday] Birthday STORED: ${normalizedDate} | hasYear=${hasYear} | source=${source} | charId=${characterId} | recordId=${newRecord?.id}`);

    return Response.json({
      found: true,
      stored: true,
      updated: false,
      date: normalizedDate,
      hasYear,
      recordId: newRecord?.id,
      source,
    });

  } catch (error) {
    console.error('[captureUserBirthday] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});