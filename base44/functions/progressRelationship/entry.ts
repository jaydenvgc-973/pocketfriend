/**
 * RELATIONSHIP PROGRESSION SYSTEM
 * Tracks relationship arc stages and advances or regresses them
 * based on interaction patterns, life events, and relationship scores.
 *
 * Arc stages (in order):
 * strangers → acquaintances → friends → close_friends → dating →
 * serious → committed → engaged → married
 *
 * Regression path:
 * any → tension → conflict → estranged → broken
 *
 * Also handles: reconciliation → restored to previous stage
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const PROGRESSION_STAGES = [
  'strangers', 'acquaintances', 'friends', 'close_friends',
  'dating', 'serious', 'committed', 'engaged', 'married',
];

const REGRESSION_STAGES = ['tension', 'conflict', 'estranged', 'broken'];

function getStageIndex(stage) {
  return PROGRESSION_STAGES.indexOf(stage);
}

function canProgress(rel) {
  const { friendship_level, romantic_level, trust_score, tension_score } = rel;
  if ((tension_score || 0) > 60) return false;
  if ((trust_score || 50) < 30) return false;

  const stage = rel.relationship_stage || 'acquaintances';
  const idx = getStageIndex(stage);

  // Stage-specific thresholds
  if (idx <= 1) return (friendship_level || 0) >= 60; // acquaintances → friends
  if (idx === 2) return (friendship_level || 0) >= 80; // friends → close_friends
  if (idx === 3) return (romantic_level || 0) >= 40 && (friendship_level || 0) >= 70; // dating
  if (idx >= 4) return (romantic_level || 0) >= 70 && (trust_score || 50) >= 65; // serious+
  return false;
}

function shouldRegress(rel) {
  const { tension_score, trust_score } = rel;
  return (tension_score || 0) > 75 || (trust_score || 50) < 20;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { characterId, targetCharacterId, forceStage } = body;

    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    const character = (await base44.entities.Character.filter({ id: characterId }))[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    // Get RelationshipState record
    const relStates = await base44.entities.RelationshipState.filter({ character_id: characterId });
    const relState = relStates[0];

    // Get the relationship entry in fictional_relationships toward targetCharacterId
    const relEntry = targetCharacterId
      ? (character.fictional_relationships || []).find(r => r.related_character_id === targetCharacterId)
      : null;

    const currentStage = forceStage || relEntry?.relationship_stage || 'acquaintances';
    const currentIdx = getStageIndex(currentStage);

    const scores = {
      friendship_level: relEntry?.friendship_level ?? relState?.friendship_score ?? 50,
      romantic_level: relEntry?.romantic_level ?? relState?.romantic_score ?? 0,
      trust_score: relState?.trust_score ?? 50,
      tension_score: relState?.tension_score ?? 0,
      relationship_stage: currentStage,
    };

    let newStage = currentStage;
    let changeType = 'none';
    let reason = '';

    if (forceStage) {
      newStage = forceStage;
      changeType = 'forced';
      reason = 'Stage manually set';
    } else if (shouldRegress(scores) && !REGRESSION_STAGES.includes(currentStage)) {
      newStage = 'tension';
      changeType = 'regression';
      reason = `High tension (${scores.tension_score}) or low trust (${scores.trust_score})`;
    } else if (REGRESSION_STAGES.includes(currentStage) && scores.tension_score < 40 && scores.trust_score > 50) {
      // Reconciliation
      newStage = 'friends';
      changeType = 'reconciliation';
      reason = 'Tension resolved, trust restored';
    } else if (canProgress(scores) && currentIdx < PROGRESSION_STAGES.length - 1) {
      newStage = PROGRESSION_STAGES[currentIdx + 1];
      changeType = 'progression';
      reason = `Scores support advancing from ${currentStage} to ${newStage}`;
    }

    if (changeType === 'none') {
      return Response.json({ changed: false, current_stage: currentStage, reason: 'No change warranted' });
    }

    // Update the relationship entry
    if (relEntry && targetCharacterId) {
      const updatedRels = (character.fictional_relationships || []).map(r =>
        r.related_character_id === targetCharacterId
          ? { ...r, relationship_stage: newStage, current_status: `Stage: ${newStage}` }
          : r
      );
      await base44.entities.Character.update(characterId, { fictional_relationships: updatedRels });
    }

    // Log as a life event
    await base44.entities.LifeEvent.create({
      character_id: characterId,
      character_name: character.name,
      event_type: 'relationship_shift',
      valence: changeType === 'regression' ? 'negative' : 'positive',
      severity: 'moderate',
      title: `Relationship ${changeType}: ${currentStage} → ${newStage}`,
      description: reason,
      triggered_by: 'life_simulation',
      systems_updated: ['relationship'],
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      changed: true,
      change_type: changeType,
      from: currentStage,
      to: newStage,
      reason,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});