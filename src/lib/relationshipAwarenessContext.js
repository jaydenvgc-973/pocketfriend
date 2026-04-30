/**
 * Relationship Awareness Context Builder
 * Retrieves and formats relationship data for character response generation
 * Ensures characters recognize and can recall people in their world
 */

/**
 * Build relationship awareness context from fictional_relationships
 * Includes People in Their World + Characters They Know
 */
export async function buildRelationshipAwarenessContext(character, allCharacters = []) {
  if (!character || !character.fictional_relationships) {
    return null;
  }

  const relationships = character.fictional_relationships || [];
  if (relationships.length === 0) {
    return null;
  }

  // Separate into two groups: linked (Characters They Know) vs unlinked (People in Their World)
  const linkedRels = [];
  const unlinkedRels = [];

  for (const rel of relationships) {
    if (rel.related_character_id) {
      // This is a linked relationship — find the actual character
      const linkedChar = allCharacters.find(c => c.id === rel.related_character_id);
      if (linkedChar) {
        linkedRels.push({
          person_name: linkedChar.name,
          character_id: linkedChar.id,
          relationship_type: rel.relationship_type,
          description: rel.description || '',
          emotional_context: rel.current_status || '',
          friendship_level: rel.friendship_level ?? 75,
          trust_level: rel.trust_level ?? 50,
          romantic_level: rel.romantic_level ?? 0,
          respect_level: rel.respect_level ?? 50,
          is_active_character: true,
          last_interaction_summary: rel.last_interaction_summary || '',
        });
      }
    } else {
      // Unlinked NPC in their world
      unlinkedRels.push({
        person_name: rel.person_name,
        relationship_type: rel.relationship_type,
        description: rel.description || '',
        is_npc: true,
        context_note: rel.emotional_impact || '',
      });
    }
  }

  if (linkedRels.length === 0 && unlinkedRels.length === 0) {
    return null;
  }

  return {
    charactersTheyKnow: linkedRels,
    peopleInTheirWorld: unlinkedRels,
  };
}

/**
 * Format relationship context for LLM prompt injection
 * Makes relationships explicit in the narrative generation context
 */
export function formatRelationshipContextForLLM(relationshipContext, characterName) {
  if (!relationshipContext) {
    return '';
  }

  const parts = [];

  // Characters They Know (active characters)
  if (relationshipContext.charactersTheyKnow?.length > 0) {
    parts.push('═══════════════════════════════════');
    parts.push('CHARACTERS THEY KNOW (ACTIVE RELATIONSHIPS)');
    parts.push('═══════════════════════════════════');

    for (const rel of relationshipContext.charactersTheyKnow) {
      const relType = rel.relationship_type || 'acquaintance';
      const friendship = Math.round(rel.friendship_level || 75);
      const trust = Math.round(rel.trust_level || 50);
      const romantic = Math.round(rel.romantic_level || 0);

      let relLabel = relType;
      if (romantic > 60) relLabel += ' (romantic interest)';
      else if (friendship > 75) relLabel += ' (close friend)';
      else if (friendship > 50) relLabel += ' (friend)';

      parts.push(`\n${rel.person_name}: ${relLabel}`);
      parts.push(`  Friendship: ${friendship}/100 | Trust: ${trust}/100 | Romantic: ${romantic}/100`);

      if (rel.description) {
        parts.push(`  Context: ${rel.description.substring(0, 120)}`);
      }
      if (rel.last_interaction_summary) {
        parts.push(`  Last interaction: ${rel.last_interaction_summary.substring(0, 100)}`);
      }
      if (rel.emotional_context) {
        parts.push(`  Current status: ${rel.emotional_context}`);
      }
    }
  }

  // People in Their World (NPCs)
  if (relationshipContext.peopleInTheirWorld?.length > 0) {
    parts.push('\n═══════════════════════════════════');
    parts.push('PEOPLE IN THEIR WORLD (NPCs / CONTACTS)');
    parts.push('═══════════════════════════════════');

    for (const person of relationshipContext.peopleInTheirWorld) {
      const relType = person.relationship_type || 'contact';

      parts.push(`\n${person.person_name}: ${relType}`);
      if (person.description) {
        parts.push(`  Who they are: ${person.description.substring(0, 100)}`);
      }
      if (person.context_note) {
        parts.push(`  Context: ${person.context_note.substring(0, 100)}`);
      }
    }
  }

  // Awareness rules
  parts.push('\n═══════════════════════════════════');
  parts.push('RELATIONSHIP AWARENESS RULE');
  parts.push('═══════════════════════════════════');
  parts.push(`${characterName} knows these people. If they are mentioned or if ${characterName} is having contact with them:`);
  parts.push('  • Recognize them by name');
  parts.push('  • Remember the relationship type and history');
  parts.push('  • Reference prior interactions naturally if relevant');
  parts.push('  • Match emotional tone to the relationship status');
  parts.push('  • Do not treat them as strangers');
  parts.push('═══════════════════════════════════');

  return parts.join('\n');
}

/**
 * Extract relationship person names for mention detection
 * Used to check if a mentioned person is in their relationship network
 */
export function getRelationshipContactNames(relationshipContext) {
  if (!relationshipContext) return [];

  const names = [
    ...(relationshipContext.charactersTheyKnow || []).map(r => r.person_name),
    ...(relationshipContext.peopleInTheirWorld || []).map(r => r.person_name),
  ];

  return names.filter(Boolean);
}

/**
 * Find a specific relationship by name
 * Used when the character references someone to recall history
 */
export function findRelationshipByName(name, relationshipContext) {
  if (!relationshipContext || !name) return null;

  // Check Characters They Know first (more detailed)
  const known = relationshipContext.charactersTheyKnow?.find(r =>
    r.person_name?.toLowerCase() === name.toLowerCase()
  );
  if (known) return known;

  // Check People in Their World
  const unlinked = relationshipContext.peopleInTheirWorld?.find(r =>
    r.person_name?.toLowerCase() === name.toLowerCase()
  );
  return unlinked || null;
}

/**
 * Build relationship recall prompt for when character talks about someone
 * Helps LLM remember and reference the relationship naturally
 */
export function buildRelationshipRecallPrompt(personName, relationship) {
  if (!relationship) {
    return `${personName} is not in ${personName}'s known contacts.`;
  }

  const parts = [];

  parts.push(`Recalling ${personName}:`);
  parts.push(`  Relationship: ${relationship.relationship_type}`);

  if (relationship.friendship_level !== undefined) {
    parts.push(`  Friendship level: ${Math.round(relationship.friendship_level)}/100`);
  }
  if (relationship.trust_level !== undefined) {
    parts.push(`  Trust: ${Math.round(relationship.trust_level)}/100`);
  }
  if (relationship.romantic_level && relationship.romantic_level > 0) {
    parts.push(`  Romantic interest: ${Math.round(relationship.romantic_level)}/100`);
  }
  if (relationship.description) {
    parts.push(`  Context: ${relationship.description}`);
  }
  if (relationship.last_interaction_summary) {
    parts.push(`  Last interaction: ${relationship.last_interaction_summary}`);
  }

  return parts.join('\n');
}