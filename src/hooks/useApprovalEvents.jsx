import { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";

/**
 * useApprovalEvents
 *
 * Hook that manages approval pop-up state for life events detected in chat:
 * - Move-in together
 * - Marriage
 * - Birth / child NPC
 * - Education details (past/present/future)
 * - General background details (hometown, job history, skills, etc.)
 *
 * Usage: call checkForApprovalEvents(characterReply, character, allCharacters, userMessage) after each chat turn.
 */

// ── EDUCATION PATTERNS ───────────────────────────────────────────────────────
const EDUCATION_PAST_PATTERNS = [
  // "graduated from Rutgers University"
  { pattern: /graduated\s+from\s+([\w\s']+(?:college|university|school|academy|institute|high school|community college))/i, group: 1 },
  // "I graduated in 2014" — capture the whole match, then scan for institution in same text
  { pattern: /graduated\s+(?:back\s+)?in\s+\d{4}/i, group: 0 },
  // "It is Rutgers University" / "went to Rutgers University"
  { pattern: /(?:went\s+to|attended|it\s+(?:is|was)|from|at)\s+([\w\s']{2,40}(?:college|university|school|academy|institute|high school|community college))/i, group: 1 },
  // bare institution name: "Rutgers University", "NYU", "Howard University"
  { pattern: /\b([\w\s']{2,30}(?:college|university|institute|academy))\b/i, group: 1 },
  { pattern: /degree\s+(?:from|in|at)\s+([\w\s']+)/i, group: 1 },
  { pattern: /studied\s+(?:at\s+)?([\w\s']+(?:college|university|school|academy|institute))/i, group: 1 },
  { pattern: /got\s+(?:my\s+)?(?:diploma|degree|certificate|GED)/i, group: 0 },
  { pattern: /finished\s+(?:my\s+|up\s+)?(?:back\s+in\s+\d{4}|degree|studies|school|college)/i, group: 0 },
];

const EDUCATION_ONGOING_PATTERNS = [
  { pattern: /(?:i'm|i am|i'm)\s+(?:currently\s+)?(?:taking|enrolled|studying)\s+(?:classes\s+)?(?:at\s+)?([\w\s']+(?:college|university|school|academy|institute))/i, group: 1 },
  { pattern: /(?:i'm|i am)\s+(?:in|at)\s+([\w\s']+(?:college|university|school|academy|institute|high school))/i, group: 1 },
  { pattern: /(?:i'm|i am)\s+working\s+on\s+(?:my\s+)?(?:degree|certification|diploma|GED)/i, group: 0 },
  { pattern: /(?:taking|have)\s+classes?\s+(?:at\s+)?([\w\s']+)/i, group: 1 },
];

const EDUCATION_FUTURE_PATTERNS = [
  { pattern: /(?:want|plan|hoping|going)\s+to\s+(?:go\s+to|attend|enroll\s+at)\s+([\w\s']+(?:college|university|school|academy|institute))/i, group: 1 },
  { pattern: /(?:applying|applied)\s+to\s+([\w\s']+(?:college|university|school|academy|institute))/i, group: 1 },
  { pattern: /(?:next|after)\s+(?:year|semester|fall|spring)\s+(?:i'll|i will|i'm going to)\s+(?:go|attend|start)/i, group: 0 },
  { pattern: /thinking\s+about\s+going\s+(?:back\s+to\s+)?(?:school|college|university)/i, group: 0 },
];

// ── BACKGROUND DETAIL PATTERNS ───────────────────────────────────────────────
// STRICT patterns — must clearly indicate the category with explicit phrasing.
// Each entry includes: category, pattern, capture group index, label, and the character field to check.
const BACKGROUND_PATTERNS = [
  {
    category: 'hometown',
    // Must explicitly say "grew up in X", "born in X", "raised in X", or "I'm from [City/State]"
    // "from" alone is NOT enough — must be "I'm from" or "I am from" + a proper noun-like location
    pattern: /(?:grew\s+up\s+in|born\s+in|raised\s+in|i'?m\s+from|i\s+am\s+from)\s+([A-Z][a-zA-Z\s]{2,30}(?:,\s*[A-Z]{2})?)/,
    group: 1,
    label: 'Hometown/Origin',
    profileField: 'city', // block if character.city is already set
  },
  {
    category: 'past_job',
    // Must explicitly reference past employment
    pattern: /(?:used\s+to\s+work\s+(?:as|at)|worked\s+(?:as|at)|my\s+(?:previous|former|last)\s+job\s+was)\s+([\w\s']{3,50})/i,
    group: 1,
    label: 'Past Job/Work History',
    profileField: null, // no single field to block on — always allowed if not already in memory
  },
  {
    category: 'religion',
    // Must self-identify — "I am Christian", "I'm Muslim", etc.
    pattern: /\bi'?m\s+(christian|muslim|jewish|buddhist|catholic|protestant|atheist|agnostic|hindu|sikh)\b/i,
    group: 1,
    label: 'Religious Background',
    profileField: 'religion', // block if character.religion is already set and non-default
  },
  {
    category: 'health',
    // Must be a clear medical self-disclosure
    pattern: /(?:i(?:'ve| have| was)\s+(?:been\s+)?(?:diagnosed\s+with|living\s+with|recovering\s+from|managing))\s+([\w\s]{3,40})/i,
    group: 1,
    label: 'Health/Medical Detail',
    profileField: 'health_status', // block if already set
  },
];

// Extract candidate text and match sentence
// Try to extract an institution name from the full text block
function extractInstitutionFromText(text) {
  const instMatch = text.match(/\b([\w\s']{2,40}(?:college|university|institute|academy|high school|community college))\b/i);
  return instMatch ? instMatch[1]?.trim() : null;
}

function extractEducationDetail(text) {
  for (const { pattern, group } of EDUCATION_PAST_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      let detail = group > 0 ? match[group]?.trim() : match[0]?.trim();
      // If the matched detail is just a year or "graduated in 2014", try to find an institution name in the full text
      if (/^\d{4}$/.test(detail) || /^graduated/i.test(detail)) {
        const institution = extractInstitutionFromText(text);
        if (institution) detail = institution;
      }
      return { detail, status: 'completed', sentence: extractSentenceContaining(text, match[0]) };
    }
  }
  for (const { pattern, group } of EDUCATION_ONGOING_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { detail: group > 0 ? match[group]?.trim() : match[0]?.trim(), status: 'ongoing', sentence: extractSentenceContaining(text, match[0]) };
  }
  for (const { pattern, group } of EDUCATION_FUTURE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { detail: group > 0 ? match[group]?.trim() : match[0]?.trim(), status: 'planned', sentence: extractSentenceContaining(text, match[0]) };
  }
  return null;
}

// STRICT: extracted detail must look like a real value (not pronouns, slang, conversational filler)
const INVALID_DETAIL_PATTERNS = [
  /^(you|me|him|her|them|it|this|that|there|here|us|we|they|i|my|your|his|her|their|its)$/i,
  /^(from you|for you|with you|about you|of you|by you)$/i,
  /^[\s\W]+$/, // only whitespace or punctuation
];

function isValidDetailValue(detail, category) {
  if (!detail || detail.trim().length < 3) return false;
  const trimmed = detail.trim();
  // Block pronoun-only or filler values
  if (INVALID_DETAIL_PATTERNS.some(p => p.test(trimmed))) return false;
  // Hometown must look like a proper noun (starts with uppercase or contains a comma for "City, ST")
  if (category === 'hometown' && !/^[A-Z]/.test(trimmed)) return false;
  // Block if it's just common conversational words
  const FILLER_WORDS = ['things', 'stuff', 'something', 'anything', 'everything', 'nothing', 'someone', 'anyone', 'everyone', 'people', 'person', 'places', 'time', 'way', 'lot'];
  if (FILLER_WORDS.includes(trimmed.toLowerCase())) return false;
  return true;
}

function extractBackgroundDetail(text, character) {
  for (const { category, pattern, group, label, profileField } of BACKGROUND_PATTERNS) {
    // STEP 1: Field existence check — if character already has this field set, skip entirely
    if (profileField && character) {
      const existingValue = character[profileField];
      const isDefaultReligion = profileField === 'religion' && (!existingValue || existingValue === 'None');
      if (existingValue && !isDefaultReligion) continue; // field already populated — block detection
    }

    const match = text.match(pattern);
    if (!match) continue;

    // STEP 2: Extract the captured group value
    const rawDetail = (group > 0 ? match[group] : match[0])?.trim();

    // STEP 3: Meaningful value check
    if (!isValidDetailValue(rawDetail, category)) continue;

    // STEP 4: Length sanity check
    if (rawDetail.length < 3 || rawDetail.length > 100) continue;

    return {
      detail: rawDetail,
      category,
      label,
      sentence: extractSentenceContaining(text, match[0]),
    };
  }
  return null;
}

function extractSentenceContaining(fullText, substring) {
  if (!substring) return fullText;
  const sentences = fullText.split(/(?<=[.!?])\s+/);
  const found = sentences.find(s => s.toLowerCase().includes(substring.toLowerCase()));
  return found || fullText.substring(0, 200);
}

// Patterns for detecting events in character replies
const MOVE_IN_PATTERNS = [
  /mov(e|ing|ed)\s+(in|together)/i,
  /liv(e|ing)\s+together/i,
  /shar(e|ing)\s+(a\s+)?place/i,
  /shar(e|ing)\s+(a\s+)?apartment/i,
  /our\s+(new\s+)?place/i,
  /our\s+(new\s+)?apartment/i,
  /we('re|re|'re)\s+moving/i,
];

const MARRIAGE_PATTERNS = [
  /getting\s+married/i,
  /we('re|re)\s+engaged/i,
  /proposed\s+to/i,
  /said\s+yes/i,
  /will\s+you\s+marry/i,
  /our\s+wedding/i,
  /tied\s+the\s+knot/i,
  /got\s+married/i,
  /my\s+(husband|wife)\s+now/i,
];

const BIRTH_PATTERNS = [
  /had\s+(a\s+)?baby/i,
  /gave\s+birth/i,
  /baby\s+was\s+born/i,
  /we('re|re)\s+parents\s+now/i,
  /she('s|s)\s+born/i,
  /he('s|s)\s+born/i,
  /our\s+(new\s+)?baby/i,
  /in\s+labor/i,
  /delivered\s+(a\s+)?baby/i,
  /newborn/i,
  /she\s+had\s+the\s+baby/i,
];

export function useApprovalEvents() {
  const [pendingApproval, setPendingApproval] = useState(null); // { type, data }
  const [dismissed, setDismissed] = useState(new Set()); // track dismissed events to avoid re-prompting

  const checkForApprovalEvents = useCallback((characterReply, character, allCharacters = [], userMessage = '') => {
    if (!characterReply || !character) return;

    const combined = characterReply + ' ' + userMessage;
    const combinedLower = combined.toLowerCase();
    const eventKey_moveIn = `move_in_${character.id}`;
    const eventKey_marriage = `marriage_${character.id}`;
    const eventKey_birth = `birth_${character.id}`;

    // Don't re-prompt for recently dismissed events
    if (!dismissed.has(eventKey_moveIn) && MOVE_IN_PATTERNS.some(p => p.test(combinedLower))) {
      const otherCharName = allCharacters.find(c => c.id !== character.id && combinedLower.includes(c.name.toLowerCase()))?.name;
      setPendingApproval({
        type: 'move_in',
        data: { character, otherCharName: otherCharName || null, eventKey: eventKey_moveIn }
      });
      return;
    }

    if (!dismissed.has(eventKey_marriage) && MARRIAGE_PATTERNS.some(p => p.test(combinedLower))) {
      const otherCharName = allCharacters.find(c => c.id !== character.id && combinedLower.includes(c.name.toLowerCase()))?.name;
      setPendingApproval({
        type: 'marriage',
        data: { character, otherCharName: otherCharName || null, eventKey: eventKey_marriage }
      });
      return;
    }

    if (!dismissed.has(eventKey_birth) && BIRTH_PATTERNS.some(p => p.test(combinedLower))) {
      const otherParentName = allCharacters.find(c => c.id !== character.id && combinedLower.includes(c.name.toLowerCase()))?.name;
      setPendingApproval({
        type: 'birth',
        data: { character, otherParentName: otherParentName || null, eventKey: eventKey_birth }
      });
      return;
    }

    // ── EDUCATION DETECTION ─────────────────────────────────────────────────
    // STEP 1: Block if ongoing education is already set on the character profile
    const hasOngoingEdu = character.current_education_activity && character.current_education_activity !== 'none';
    const eventKey_edu = `education_${character.id}_${Date.now()}`;
    const eduResult = !hasOngoingEdu ? extractEducationDetail(combined) : null;
    if (eduResult && eduResult.detail && eduResult.detail.length > 3 && eduResult.detail.length < 100) {
      setPendingApproval({
        type: 'education',
        data: {
          character,
          detail: eduResult.detail,
          status: eduResult.status, // 'completed' | 'ongoing' | 'planned'
          sentence: eduResult.sentence,
          eventKey: eventKey_edu,
        }
      });
      return;
    }

    // ── BACKGROUND DETAIL DETECTION ─────────────────────────────────────────
    const eventKey_bg = `background_${character.id}_${Date.now()}`;
    const bgResult = extractBackgroundDetail(combined, character);
    if (bgResult && bgResult.detail && bgResult.detail.length > 3 && bgResult.detail.length < 150) {
      setPendingApproval({
        type: 'background_detail',
        data: {
          character,
          detail: bgResult.detail,
          category: bgResult.category,
          label: bgResult.label,
          sentence: bgResult.sentence,
          eventKey: eventKey_bg,
        }
      });
      return;
    }
  }, [dismissed]);

  const dismissApproval = useCallback(() => {
    if (pendingApproval?.data?.eventKey) {
      setDismissed(prev => new Set([...prev, pendingApproval.data.eventKey]));
    }
    setPendingApproval(null);
  }, [pendingApproval]);

  const approveEvent = useCallback(async (approvalData) => {
    if (!pendingApproval) return;
    const { type, data } = pendingApproval;

    if (type === 'move_in' && data.character) {
      // Log life event for move-in — actual household update would need more data
      await base44.entities.LifeEvent.create({
        character_id: data.character.id,
        character_name: data.character.name,
        event_type: 'life_milestone_event',
        valence: 'positive',
        severity: 'significant',
        title: 'Moved in together',
        description: `${data.character.name} is moving in${data.otherCharName ? ` with ${data.otherCharName}` : ''}.`,
        emotional_impact: 'A significant life change — sharing a home.',
        triggered_by: 'user_message',
        timestamp: new Date().toISOString(),
        systems_updated: ['memory'],
      }).catch(() => {});
    }

    if (type === 'marriage' && data.character) {
      await base44.entities.LifeEvent.create({
        character_id: data.character.id,
        character_name: data.character.name,
        event_type: 'life_milestone_event',
        valence: 'positive',
        severity: 'major',
        title: 'Got married',
        description: `${data.character.name} got married${data.otherCharName ? ` to ${data.otherCharName}` : ''}.`,
        emotional_impact: 'A major life milestone.',
        triggered_by: 'user_message',
        timestamp: new Date().toISOString(),
        systems_updated: ['memory'],
      }).catch(() => {});
    }

    if (type === 'education' && data.character) {
      const { detail, status, character: char } = data;
      const statusLabel = status === 'completed' ? 'Completed' : status === 'ongoing' ? 'Ongoing' : 'Planned';
      if (status === 'completed') {
        const existing = char.completed_education || [];
        await base44.entities.Character.update(char.id, {
          completed_education: [...existing, { course_name: detail, completion_date: new Date().toISOString() }],
        }).catch(() => {});
      } else if (status === 'ongoing') {
        await base44.entities.Character.update(char.id, {
          current_education_activity: detail,
        }).catch(() => {});
      } else if (status === 'planned') {
        // Store as a memory / life goal note — no direct field for planned education
        await base44.entities.Memory.create({
          character_id: char.id,
          memory_type: 'fact',
          memory_text: `${char.name} plans to attend or study: ${detail}`,
          memory_summary: `Education plan: ${detail}`,
          importance_score: 5,
          permanence: 'long_term',
        }).catch(() => {});
      }
    }

    if (type === 'background_detail' && data.character) {
      const { detail, category, character: char } = data;
      const updatePayload = {};
      if (category === 'hometown') updatePayload.city = detail.trim();
      // For other categories, store as a memory
      if (!updatePayload.city) {
        await base44.entities.Memory.create({
          character_id: char.id,
          memory_type: category === 'family' ? 'relationship' : 'fact',
          memory_text: detail,
          memory_summary: detail.substring(0, 80),
          importance_score: 5,
          permanence: 'long_term',
        }).catch(() => {});
      } else {
        await base44.entities.Character.update(char.id, updatePayload).catch(() => {});
      }
    }

    if (type === 'birth' && data.character) {
      const childName = approvalData?.childName;
      if (childName) {
        // Add child as NPC in fictional_relationships
        const charArr = await base44.entities.Character.filter({ id: data.character.id });
        const char = charArr[0];
        if (char) {
          const existingRels = char.fictional_relationships || [];
          const childEntry = {
            person_name: childName,
            relationship_type: 'child',
            description: `${data.character.name}'s child, born recently.`,
            current_status: 'newborn',
            emotional_impact: 'A precious new family member.',
            friendship_level: 100,
            chosen_family_level: 100,
          };
          await base44.entities.Character.update(data.character.id, {
            fictional_relationships: [...existingRels, childEntry],
          });

          // Add to family_members as well
          const existingFamily = char.family_members || [];
          await base44.entities.Character.update(data.character.id, {
            family_members: [...existingFamily, { name: childName, relationship_type: 'child' }],
          });
        }
      }

      await base44.entities.LifeEvent.create({
        character_id: data.character.id,
        character_name: data.character.name,
        event_type: 'life_milestone_event',
        valence: 'positive',
        severity: 'major',
        title: childName ? `${childName} was born` : 'Baby born',
        description: `${data.character.name} had a baby${childName ? ` — ${childName}` : ''}.`,
        emotional_impact: 'Life-changing joy.',
        triggered_by: 'user_message',
        timestamp: new Date().toISOString(),
        systems_updated: ['memory'],
      }).catch(() => {});
    }

    dismissApproval();
  }, [pendingApproval, dismissApproval]);

  return { pendingApproval, checkForApprovalEvents, approveEvent, dismissApproval };
}