import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── CONFINEMENT LOGIC (mirrors lib/confinementMessagingEngine.js exactly) ────────

function isCharacterConfined(character) {
  if (!character) return false;
  if (character.is_jailed === true) return true;
  const validIncarcerationStatuses = ['pretrial', 'sentenced', 'serving', 'solitary', 'work_release', 'transferred'];
  if (character.incarceration_status && validIncarcerationStatuses.includes(character.incarceration_status)) {
    if (character.jail_release_date) {
      const releaseDate = new Date(character.jail_release_date);
      if (releaseDate > new Date()) return true;
    } else if (character.incarceration_status !== 'released' && character.incarceration_status !== 'paroled') {
      return true;
    }
  }
  if (character.house_arrest_active === true) return true;
  if (character.resolved_presence_status === 'incarcerated' || character.resolved_presence_status === 'house_arrest') return true;
  if (character.resolved_location_type === 'incarcerated' || character.resolved_location_type === 'house_arrest') return true;
  return false;
}

// Time check with injectable hour (for testing). Production uses real EST.
function isWithinMessagingHoursAt(estHour) {
  return estHour >= 9 && estHour < 21;
}

function getESTHour() {
  const nowEST = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  return parseInt(nowEST, 10);
}

function canCharacterRespondAt(character, estHour) {
  if (!isCharacterConfined(character)) return { allowed: true };
  if (!isWithinMessagingHoursAt(estHour)) {
    return { allowed: false, reason: 'Currently confined and will only be able to respond between 9:00 a.m. and 9:00 p.m.' };
  }
  return { allowed: true };
}

// ── MOCK CHARACTERS ────────────────────────────────────────────────────────────

const CONFINED_VIA_IS_JAILED = {
  id: 'mock_jailed_001',
  name: 'TestJailed_isJailed',
  is_jailed: true,
  incarceration_status: 'serving',
  resolved_presence_status: 'incarcerated',
};

const CONFINED_VIA_INCARCERATION_STATUS = {
  id: 'mock_jailed_002',
  name: 'TestJailed_incarceration_status',
  is_jailed: false,
  incarceration_status: 'sentenced',
  resolved_presence_status: null,
};

const CONFINED_VIA_HOUSE_ARREST = {
  id: 'mock_jailed_003',
  name: 'TestJailed_houseArrest',
  is_jailed: false,
  house_arrest_active: true,
  resolved_presence_status: 'house_arrest',
};

const CONFINED_VIA_PRESENCE = {
  id: 'mock_jailed_004',
  name: 'TestJailed_presenceStatus',
  is_jailed: false,
  resolved_presence_status: 'incarcerated',
};

const NON_CONFINED = {
  id: 'mock_free_001',
  name: 'TestFree_normalCharacter',
  is_jailed: false,
  incarceration_status: null,
  house_arrest_active: false,
  resolved_presence_status: 'home',
};

const RELEASED = {
  id: 'mock_released_001',
  name: 'TestReleased_paroled',
  is_jailed: false,
  incarceration_status: 'released',
  resolved_presence_status: 'home',
};

// ── TEST RUNNER ───────────────────────────────────────────────────────────────

function runTest(label, condition, detail = '') {
  return { label, result: condition ? 'PASS' : 'FAIL', detail };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const results = [];

  // ── SECTION 1: isCharacterConfined detection ─────────────────────────────
  results.push(runTest(
    '1a. is_jailed=true → confined',
    isCharacterConfined(CONFINED_VIA_IS_JAILED) === true,
    `is_jailed=${CONFINED_VIA_IS_JAILED.is_jailed}`
  ));
  results.push(runTest(
    '1b. incarceration_status=sentenced (no release date) → confined',
    isCharacterConfined(CONFINED_VIA_INCARCERATION_STATUS) === true,
    `incarceration_status=${CONFINED_VIA_INCARCERATION_STATUS.incarceration_status}`
  ));
  results.push(runTest(
    '1c. house_arrest_active=true → confined',
    isCharacterConfined(CONFINED_VIA_HOUSE_ARREST) === true,
    `house_arrest_active=${CONFINED_VIA_HOUSE_ARREST.house_arrest_active}`
  ));
  results.push(runTest(
    '1d. resolved_presence_status=incarcerated → confined',
    isCharacterConfined(CONFINED_VIA_PRESENCE) === true,
    `resolved_presence_status=${CONFINED_VIA_PRESENCE.resolved_presence_status}`
  ));
  results.push(runTest(
    '1e. normal character (home, no flags) → NOT confined',
    isCharacterConfined(NON_CONFINED) === false,
    `resolved_presence_status=${NON_CONFINED.resolved_presence_status}`
  ));
  results.push(runTest(
    '1f. released character → NOT confined',
    isCharacterConfined(RELEASED) === false,
    `incarceration_status=${RELEASED.incarceration_status}`
  ));

  // ── SECTION 2: Messaging hour logic (injected EST hours) ─────────────────
  // Boundary cases: 8:59 AM = hour 8 → blocked, 9:00 AM = hour 9 → allowed
  //                 8:59 PM = hour 20 → allowed, 9:00 PM = hour 21 → blocked

  const hourCases = [
    { label: '2a. EST 08 (8:59 AM) → BLOCKED for confined', hour: 8, expectedAllowed: false },
    { label: '2b. EST 09 (9:00 AM) → ALLOWED for confined', hour: 9, expectedAllowed: true },
    { label: '2c. EST 20 (8:59 PM) → ALLOWED for confined', hour: 20, expectedAllowed: true },
    { label: '2d. EST 21 (9:00 PM) → BLOCKED for confined', hour: 21, expectedAllowed: false },
    { label: '2e. EST 00 (midnight) → BLOCKED for confined', hour: 0, expectedAllowed: false },
    { label: '2f. EST 14 (2:00 PM) → ALLOWED for confined', hour: 14, expectedAllowed: true },
  ];

  for (const tc of hourCases) {
    const result = canCharacterRespondAt(CONFINED_VIA_IS_JAILED, tc.hour);
    results.push(runTest(
      tc.label,
      result.allowed === tc.expectedAllowed,
      `hour=${tc.hour} → allowed=${result.allowed}, expected=${tc.expectedAllowed}, reason="${result.reason || 'none'}"`
    ));
  }

  // ── SECTION 3: Non-confined character is ALWAYS allowed regardless of hour ──
  for (const hour of [0, 8, 9, 14, 20, 21, 23]) {
    const result = canCharacterRespondAt(NON_CONFINED, hour);
    results.push(runTest(
      `3. Non-confined always allowed at hour ${hour}`,
      result.allowed === true,
      `hour=${hour} → allowed=${result.allowed}`
    ));
  }

  // ── SECTION 4: Blocked path simulation (Chat + Text mode) ────────────────
  // Simulates what pages/Chat.js does at lines 502-522 (Text) and 557-580 (Chat)
  // with a confined character and an out-of-hours EST time

  function simulateSendMessage({ isPhone, character, estHour }) {
    const log = [];
    let llmCalled = false;
    let typingSet = false;
    let noticeCreated = false;
    let noticeContent = null;
    let returned = false;

    const modeLabel = isPhone ? 'Text/Phone' : 'Chat/Direct';

    // Phone path: confinement check (lines 502-522)
    if (isPhone) {
      if (isCharacterConfined(character)) {
        if (!isWithinMessagingHoursAt(estHour)) {
          noticeCreated = true;
          noticeContent = 'Currently confined and will only be able to respond between 9:00 a.m. and 9:00 p.m.';
          // setIsTyping(false) -- NOT setIsTyping(true) yet
          returned = true;
          log.push(`[${modeLabel}] Confinement block fired → notice created, return (no LLM, no typing)`);
        }
      }
    }

    // Chat path: confinement check (lines 557-580)
    if (!isPhone && !returned) {
      if (isCharacterConfined(character)) {
        if (!isWithinMessagingHoursAt(estHour)) {
          noticeCreated = true;
          noticeContent = 'Currently confined and will only be able to respond between 9:00 a.m. and 9:00 p.m.';
          returned = true;
          log.push(`[${modeLabel}] Confinement block fired → notice created, return (no LLM, no typing)`);
        }
      }
    }

    // If not returned yet, typing would be set and LLM called
    if (!returned) {
      typingSet = true;
      llmCalled = true;
      log.push(`[${modeLabel}] Passed all blocks → setIsTyping(true) + LLM called`);
    }

    return { modeLabel, llmCalled, typingSet, noticeCreated, noticeContent, returned, log };
  }

  // Test Chat mode, after-hours (EST hour 21 = 9 PM), confined
  const chatBlocked = simulateSendMessage({ isPhone: false, character: CONFINED_VIA_IS_JAILED, estHour: 21 });
  results.push(runTest('4a. Chat mode + after 9 PM + confined → BLOCKED (no LLM, notice created)',
    chatBlocked.returned && chatBlocked.noticeCreated && !chatBlocked.llmCalled && !chatBlocked.typingSet,
    JSON.stringify(chatBlocked.log)
  ));
  results.push(runTest('4b. Chat blocked notice text exact match',
    chatBlocked.noticeContent === 'Currently confined and will only be able to respond between 9:00 a.m. and 9:00 p.m.',
    `noticeContent="${chatBlocked.noticeContent}"`
  ));

  // Test Text/Phone mode, before-hours (EST hour 8 = 8 AM), confined
  const textBlocked = simulateSendMessage({ isPhone: true, character: CONFINED_VIA_IS_JAILED, estHour: 8 });
  results.push(runTest('4c. Text/Phone mode + before 9 AM + confined → BLOCKED (no LLM, notice created)',
    textBlocked.returned && textBlocked.noticeCreated && !textBlocked.llmCalled && !textBlocked.typingSet,
    JSON.stringify(textBlocked.log)
  ));
  results.push(runTest('4d. Text blocked notice text exact match',
    textBlocked.noticeContent === 'Currently confined and will only be able to respond between 9:00 a.m. and 9:00 p.m.',
    `noticeContent="${textBlocked.noticeContent}"`
  ));

  // Test Chat mode, within hours (EST hour 14 = 2 PM), confined → ALLOWED
  const chatAllowed = simulateSendMessage({ isPhone: false, character: CONFINED_VIA_IS_JAILED, estHour: 14 });
  results.push(runTest('4e. Chat mode + 2 PM EST + confined → ALLOWED (LLM called)',
    !chatAllowed.returned && chatAllowed.llmCalled && !chatAllowed.noticeCreated,
    JSON.stringify(chatAllowed.log)
  ));

  // Test Text/Phone mode, within hours (EST hour 15), confined → ALLOWED
  const textAllowed = simulateSendMessage({ isPhone: true, character: CONFINED_VIA_IS_JAILED, estHour: 15 });
  results.push(runTest('4f. Text/Phone mode + 3 PM EST + confined → ALLOWED (LLM called)',
    !textAllowed.returned && textAllowed.llmCalled && !textAllowed.noticeCreated,
    JSON.stringify(textAllowed.log)
  ));

  // Test Chat mode, non-confined, any hour → ALWAYS ALLOWED
  const chatFreeAfterhours = simulateSendMessage({ isPhone: false, character: NON_CONFINED, estHour: 22 });
  results.push(runTest('4g. Chat mode + 10 PM + NON-confined → ALLOWED (no block)',
    !chatFreeAfterhours.returned && chatFreeAfterhours.llmCalled,
    JSON.stringify(chatFreeAfterhours.log)
  ));

  // ── SECTION 5: Bubble label logic (mirrors MessageBubble.jsx lines 304-306) ─
  function shouldShowConfinementLabel({ message, character: char }) {
    const isUser = message.sender_type === 'user';
    const isNarrative = message.is_narrative;
    return !isUser && !isNarrative && !!message.character_id && isCharacterConfined(char);
  }

  const charMsg = { sender_type: 'character', is_narrative: false, character_id: 'mock_jailed_001', content: 'Hey' };
  const userMsg = { sender_type: 'user', is_narrative: false, character_id: null, content: 'Hello' };
  const narrativeMsg = { sender_type: 'character', is_narrative: true, character_id: 'mock_jailed_001', content: 'Some story' };

  results.push(runTest('5a. Confined character message → label shows "Confinement text app"',
    shouldShowConfinementLabel({ message: charMsg, character: CONFINED_VIA_IS_JAILED }) === true,
    'sender_type=character, is_jailed=true'
  ));
  results.push(runTest('5b. Non-confined character message → NO label',
    shouldShowConfinementLabel({ message: charMsg, character: NON_CONFINED }) === false,
    'sender_type=character, no confinement flags'
  ));
  results.push(runTest('5c. User message (confined character) → NO label (user bubble, not character)',
    shouldShowConfinementLabel({ message: userMsg, character: CONFINED_VIA_IS_JAILED }) === false,
    'sender_type=user'
  ));
  results.push(runTest('5d. Narrative message (confined character) → NO label (narrative, not bubble)',
    shouldShowConfinementLabel({ message: narrativeMsg, character: CONFINED_VIA_IS_JAILED }) === false,
    'is_narrative=true'
  ));

  // ── SECTION 6: Live current EST hour (real clock) ─────────────────────────
  const liveEstHour = getESTHour();
  const liveAllowed = isWithinMessagingHoursAt(liveEstHour);
  results.push({
    label: `6. Current EST hour = ${liveEstHour} → messaging ${liveAllowed ? 'ALLOWED' : 'BLOCKED'}`,
    result: 'INFO',
    detail: `Live clock: EST hour ${liveEstHour}, window 9–20 inclusive`
  });

  // ── SECTION 7: Look for a real confined character on account ──────────────
  let realConfinedCharacter = null;
  try {
    const jailedChars = await base44.asServiceRole.entities.Character.filter({ is_jailed: true });
    if (jailedChars.length > 0) {
      const c = jailedChars[0];
      realConfinedCharacter = {
        id: c.id,
        name: c.name,
        is_jailed: c.is_jailed,
        incarceration_status: c.incarceration_status || null,
        house_arrest_active: c.house_arrest_active || false,
        resolved_presence_status: c.resolved_presence_status || null,
        resolved_location_type: c.resolved_location_type || null,
        jail_release_date: c.jail_release_date || null,
        incarceration_facility_name: c.incarceration_facility_name || null,
        owner_email: c.owner_email || '(not set)',
      };
      results.push(runTest(
        `7. Real confined character on account: ${c.name}`,
        isCharacterConfined(c) === true,
        `id=${c.id} is_jailed=${c.is_jailed} status=${c.incarceration_status} presence=${c.resolved_presence_status}`
      ));
    } else {
      results.push({ label: '7. Real confined character', result: 'INFO', detail: 'No character with is_jailed=true found on account. Mock characters used for all tests above.' });
    }
  } catch (err) {
    results.push({ label: '7. Real confined character lookup', result: 'INFO', detail: `Query failed: ${err.message}` });
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.result === 'PASS').length;
  const failed = results.filter(r => r.result === 'FAIL').length;
  const info = results.filter(r => r.result === 'INFO').length;
  const total = passed + failed;
  const allPassed = failed === 0;

  return Response.json({
    verdict: allPassed ? `✅ ALL ${total} TESTS PASSED` : `❌ ${failed} FAILED / ${passed} PASSED`,
    passed, failed, info_count: info, total,
    live_est_hour: liveEstHour,
    real_confined_character: realConfinedCharacter,
    confinement_notice_text: 'Currently confined and will only be able to respond between 9:00 a.m. and 9:00 p.m.',
    confinement_label_text: 'Confinement text app',
    results,
  });
});