import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find James Anderson
    const characters = await base44.asServiceRole.entities.Character.list('-created_date', 100);
    const jamesAnderson = characters.find(c => c.name === 'James Anderson');

    if (!jamesAnderson) {
      return Response.json({ error: 'James Anderson not found' }, { status: 404 });
    }

    // Find Anderson bar location
    const locations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 200);
    const andersonBar = locations.find(loc => loc.name === 'Anderson' || loc.name?.includes('Anderson'));

    if (!andersonBar) {
      return Response.json({ error: 'Anderson bar not found' }, { status: 404 });
    }

    // Check if memory already exists
    const hasMemory = (jamesAnderson.fictional_relationships || []).some(r => 
      r.description?.toLowerCase().includes('inherit') &&
      r.description?.toLowerCase().includes('miller')
    );

    if (hasMemory) {
      return Response.json({ message: 'Memory already exists', character: jamesAnderson.name });
    }

    // Create the critical life event memory
    const inheritanceMemory = {
      person_name: 'Miller (Previous Owner)',
      related_character_id: null,
      relationship_type: 'mentor/predecessor',
      description: 'Miller, the original owner of the bar (then called Millers), passed away and left the business to James. This was a defining moment—inheriting the bar meant taking on the responsibility of running it and honoring Millers legacy.',
      current_status: 'James is now the owner of Anderson (formerly Millers), carrying on the legacy left to him',
      emotional_impact: 'Grateful, honored, and determined to succeed. This inheritance was both a gift and a heavy responsibility.',
      history_summary: 'Miller mentored James as a worker and saw potential in him. Upon his unexpected passing, Miller left the bar to James in his will, trusting him with his life\'s work.',
      last_interaction_summary: 'The final conversation was when Miller told James his plans—before passing, he made it clear the bar should be Jamess.',
      avatar_url: null,
      user_respect_level: 85,
      friendship_level: 80,
      romantic_level: 0,
      attraction_level: 0,
      chosen_family_level: 90
    };

    // Add memory to fictional_relationships
    const updatedRelationships = [...(jamesAnderson.fictional_relationships || []), inheritanceMemory];

    // Update character with the memory
    await base44.asServiceRole.entities.Character.update(jamesAnderson.id, {
      fictional_relationships: updatedRelationships
    });

    // Also log as a major life event
    const lifeEvent = {
      character_id: jamesAnderson.id,
      character_name: jamesAnderson.name,
      event_type: 'life_milestone_event',
      valence: 'positive',
      severity: 'major',
      title: 'Inherited Anderson Bar from Miller',
      description: 'Miller passed away and left his bar (Millers) to James. James became the new owner and renamed it Anderson. This was a pivotal moment in his life—a responsibility and an honor.',
      emotional_impact: 'Grateful, motivated, and determined to honor Millers legacy',
      triggered_by: 'manual',
      systems_updated: ['memory', 'relationship'],
      context_tags: ['ownership', 'inheritance', 'bar', 'miller', 'legacy'],
      timestamp: new Date().toISOString()
    };

    await base44.asServiceRole.entities.LifeEvent.create(lifeEvent);

    return Response.json({
      success: true,
      message: 'Critical inheritance memory injected',
      character: jamesAnderson.name,
      location: andersonBar.name,
      memoryAdded: inheritanceMemory.description
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});