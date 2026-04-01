import { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";

/**
 * useApprovalEvents
 * 
 * Hook that manages approval pop-up state for life events detected in chat:
 * - Move-in together
 * - Marriage
 * - Birth / child NPC
 * 
 * Usage: call checkForApprovalEvents(characterReply, character, allCharacters) after each chat turn.
 * Renders the appropriate pop-up component if needed.
 */

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

    const combined = (characterReply + ' ' + userMessage).toLowerCase();
    const eventKey_moveIn = `move_in_${character.id}`;
    const eventKey_marriage = `marriage_${character.id}`;
    const eventKey_birth = `birth_${character.id}`;

    // Don't re-prompt for recently dismissed events
    if (!dismissed.has(eventKey_moveIn) && MOVE_IN_PATTERNS.some(p => p.test(combined))) {
      // Try to detect who they're moving in with
      const otherCharName = allCharacters.find(c => c.id !== character.id && combined.includes(c.name.toLowerCase()))?.name;
      setPendingApproval({
        type: 'move_in',
        data: {
          character,
          otherCharName: otherCharName || null,
          eventKey: eventKey_moveIn,
        }
      });
      return;
    }

    if (!dismissed.has(eventKey_marriage) && MARRIAGE_PATTERNS.some(p => p.test(combined))) {
      const otherCharName = allCharacters.find(c => c.id !== character.id && combined.includes(c.name.toLowerCase()))?.name;
      setPendingApproval({
        type: 'marriage',
        data: {
          character,
          otherCharName: otherCharName || null,
          eventKey: eventKey_marriage,
        }
      });
      return;
    }

    if (!dismissed.has(eventKey_birth) && BIRTH_PATTERNS.some(p => p.test(combined))) {
      const otherParentName = allCharacters.find(c => c.id !== character.id && combined.includes(c.name.toLowerCase()))?.name;
      setPendingApproval({
        type: 'birth',
        data: {
          character,
          otherParentName: otherParentName || null,
          eventKey: eventKey_birth,
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