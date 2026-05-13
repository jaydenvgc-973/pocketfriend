/**
 * captureUserBirthday
 *
 * Detects and durably stores the user's birthday from any source
 * (chat message, profile, settings, onboarding).
 *
 * Writes to UserSettings (account-level, not service-role dependent).
 * Birthday is immediately available to ALL characters on the account.
 *
 * Storage schema (UserSettings):
 *   user_birthday_date:       ISO date string (YYYY-MM-DD or MM-DD)
 *   user_birthday_has_year:   boolean — is the year known?
 *   user_birthday_source:     where the birthday was detected (chat/profile/settings/onboarding)
 *   user_birthday_raw:        original raw input string
 *   user_birthday_captured_at: ISO timestamp when it was first captured
 *   user_birthday_updates:    array of {from, to, at, source} for correction history
 *
 * Deduplication: one record per user (UserSettings). If a correction is detected,
 * the existing record is updated and a correction history entry is appended.
 * Birthday is immediately readable by any character via UserSettings.owner_email.
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
    // Scope: UserSettings (account-level, one per user).
    // Birthday is stored at owner_email level, making it immediately available to all characters.
    const settingsList = await base44.entities.UserSettings.filter(
      { owner_email: user.email },
      null,
      1
    ).catch(() => []);

    const existingSettings = settingsList?.[0] || null;
    // Read from both new field (user_birthday_date) and legacy field (user_birthday)
    const existingBirthdayDate = existingSettings?.user_birthday_date || existingSettings?.user_birthday || null;
    const existingUpdates = existingSettings?.user_birthday_updates || [];

    const now = new Date().toISOString();

    // ── CORRECTION HANDLING ────────────────────────────────────────────────
    if (existingBirthdayDate === normalizedDate) {
      // Same date — already stored, no-op
      console.log(`[captureUserBirthday] Birthday already stored: ${normalizedDate} | no update needed`);
      return Response.json({
        found: true,
        stored: false,
        reason: 'already_stored',
        date: normalizedDate,
        source: 'UserSettings',
      });
    }

    // ── CREATE OR UPDATE BIRTHDAY IN UserSettings ──────────────────────────────
    const newUpdates = existingBirthdayDate
      ? [
          ...existingUpdates,
          {
            from: existingBirthdayDate,
            to: normalizedDate,
            at: now,
            source: source,
          }
        ]
      : [];

    if (existingSettings) {
      // Update existing UserSettings — write to both new and legacy field for compatibility
      await base44.entities.UserSettings.update(existingSettings.id, {
        user_birthday_date: normalizedDate,
        user_birthday: normalizedDate,
        user_birthday_has_year: hasYear,
        user_birthday_source: source,
        user_birthday_raw: rawDateStr,
        user_birthday_captured_at: existingSettings.user_birthday_captured_at || now,
        user_birthday_updates: newUpdates,
      });

      console.log(`[captureUserBirthday] Birthday UPDATED in UserSettings: ${existingBirthdayDate} → ${normalizedDate} | source=${source} | owner_email=${user.email}`);

      return Response.json({
        found: true,
        stored: true,
        updated: true,
        date: normalizedDate,
        previousDate: existingBirthdayDate,
        storedAt: 'UserSettings',
      });
    } else {
      // Create new UserSettings with birthday
      const newSettings = await base44.entities.UserSettings.create({
        owner_email: user.email,
        user_birthday_date: normalizedDate,
        user_birthday_has_year: hasYear,
        user_birthday_source: source,
        user_birthday_raw: rawDateStr,
        user_birthday_captured_at: now,
        user_birthday_updates: [],
      });

      console.log(`[captureUserBirthday] Birthday STORED in new UserSettings: ${normalizedDate} | hasYear=${hasYear} | source=${source} | owner_email=${user.email}`);

      return Response.json({
        found: true,
        stored: true,
        updated: false,
        date: normalizedDate,
        hasYear,
        storedAt: 'UserSettings',
        source,
      });
    }

  } catch (error) {
    console.error('[captureUserBirthday] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});