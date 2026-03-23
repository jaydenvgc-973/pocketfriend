import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const now = new Date();
    const characters = await base44.asServiceRole.entities.Character.list();
    
    const updates = [];

    for (const character of characters) {
      // Check education completion
      if (character.current_education_activity && character.current_education_activity !== 'none') {
        const completionDate = new Date(character.education_expected_completion_date);
        
        if (now >= completionDate) {
          // Education completed
          const completedEdu = {
            course_name: character.education_details?.course_name || character.current_education_activity,
            institution: character.education_details?.institution || 'Unknown',
            completion_date: now.toISOString()
          };

          const currentCompleted = character.completed_education || [];
          const updatedCompleted = [...currentCompleted, completedEdu];

          await base44.asServiceRole.entities.Character.update(character.id, {
            current_education_activity: 'none',
            education_start_date: null,
            education_expected_completion_date: null,
            education_details: null,
            completed_education: updatedCompleted,
            current_life_event: `Just completed ${completedEdu.course_name}! I'm proud of myself for sticking with it.`
          });

          // Create a memory of this achievement
          await base44.asServiceRole.entities.Memory.create({
            character_id: character.id,
            title: `Completed ${completedEdu.course_name}`,
            description: `Successfully completed ${completedEdu.course_name} at ${completedEdu.institution} after weeks of dedicated learning.`,
            emotional_impact: 'proud',
            lesson_learned: `I can commit to learning new things and see them through to completion.`,
            timestamp: now.toISOString(),
            source_context: 'education_completion'
          });

          updates.push({ characterId: character.id, type: 'education', action: 'completed' });
        }
      }

      // Check job training completion
      if (character.current_job_training_activity && character.current_job_training_activity !== 'none') {
        const completionDate = new Date(character.job_training_expected_completion_date);
        
        if (now >= completionDate) {
          // Job training completed
          const completedTraining = {
            training_name: character.job_training_details?.training_name || character.current_job_training_activity,
            company: character.job_training_details?.company || 'Unknown',
            position_title: character.job_training_details?.position_title || 'Unknown',
            completion_date: now.toISOString()
          };

          const currentCompleted = character.completed_job_training || [];
          const updatedCompleted = [...currentCompleted, completedTraining];

          await base44.asServiceRole.entities.Character.update(character.id, {
            current_job_training_activity: 'none',
            job_training_start_date: null,
            job_training_expected_completion_date: null,
            job_training_details: null,
            completed_job_training: updatedCompleted,
            current_life_event: `Finished training for ${completedTraining.position_title} at ${completedTraining.company}! Ready to tackle the job.`
          });

          // Create a memory of this achievement
          await base44.asServiceRole.entities.Memory.create({
            character_id: character.id,
            title: `Completed training for ${completedTraining.position_title}`,
            description: `Successfully completed job training program at ${completedTraining.company} for the position of ${completedTraining.position_title}.`,
            emotional_impact: 'proud',
            lesson_learned: `I'm ready to take on this new role and prove my abilities.`,
            timestamp: now.toISOString(),
            source_context: 'job_training_completion'
          });

          updates.push({ characterId: character.id, type: 'training', action: 'completed' });
        }
      }
    }

    return Response.json({
      success: true,
      updatesProcessed: updates.length,
      updates: updates
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});