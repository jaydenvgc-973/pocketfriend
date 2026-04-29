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
const BACKGROUND_PATTERNS = [
  { category: 'hometown', pattern: /(?:grew up|from|born|raised)\s+(?:in\s+)?([\w\s]+,?\s*[\w\s]*)/i, label: 'Hometown/Origin' },
  { category: 'hobby', pattern: /(?:love|enjoy|passionate about|really into|hobby is)\s+([\w\s]+)/i, label: 'Hobby/Interest' },
  { category: 'skill', pattern: /(?:know how to|can|trained in|skilled in|certified in)\s+([\w\s]+)/i, label: 'Skill/Certification' },
  { category: 'past_job', pattern: /(?:used to work|worked at|previous job|former(?:ly)?)\s+(?:as\s+|at\s+)?([\w\s']+)/i, label: 'Past Job/Work History' },
  { category: 'family', pattern: /(?:my\s+(?:mom|dad|mother|father|sister|brother|parents|grandma|grandpa|grandmother|grandfather))\s+(?:is|was|lives?|works?|has)/i, label: 'Family Detail' },
  { category: 'childhood', pattern: /(?:when i was (?:young|a kid|little|growing up)|as a child|my childhood)/i, label: 'Childhood Detail' },
  { category: 'career_goal', pattern: /(?:want to be|dream(?:s)? of|goal is to|aspire to)\s+([\w\s]+)/i, label: 'Career Goal' },
  { category: 'major', pattern: /(?:majored?|studied|degree)\s+in\s+([\w\s]+)/i, label: 'Academic Major/Field' },
  { category: 'religion', pattern: /(?:christian|muslim|jewish|buddhist|catholic|protestant|atheist|agnostic|religious|faith)/i, label: 'Religious Background' },
  { category: 'health', pattern: /(?:diagnosed with|living with|managing|recovering from)\s+([\w\s]+)/i, label: 'Health/Medical Detail' },
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

function extractBackgroundDetail(text) {
  for (const { category, pattern, label } of BACKGROUND_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { detail: match[0]?.trim(), category, label, sentence: extractSentenceContaining(text, match[0]) };
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
    const eventKey_edu = `education_${character.id}_${combinedLower.substring(0, 30)}`;
    if (!dismissed.has(eventKey_edu)) {
      const eduResult = extractEducationDetail(combined);
      if (eduResult && eduResult.detail && eduResult.detail.length > 3 && eduResult.detail.length < 100) {
        // Check if this is already saved
        const existingEdu = [
          character.education_details?.course_name,
          character.education_location_name,
          character.current_education_activity !== 'none' ? character.current_education_activity : null,
          ...(character.completed_education || []).map(e => e.course_name),
          ...(character.additional_education_locations || []).map(l => l.program_name || l.location_name),
        ].filter(Boolean).map(v => v.toLowerCase());
        const alreadySaved = existingEdu.some(e => e.includes(eduResult.detail.toLowerCase()) || eduResult.detail.toLowerCase().includes(e));
        if (!alreadySaved) {
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
      }
    }

    // ── BACKGROUND DETAIL DETECTION ─────────────────────────────────────────
    const eventKey_bg = `background_${character.id}_${combinedLower.substring(0, 30)}`;
    if (!dismissed.has(eventKey_bg)) {
      const bgResult = extractBackgroundDetail(combined);
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