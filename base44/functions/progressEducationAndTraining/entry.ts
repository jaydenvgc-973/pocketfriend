/**
 * EDUCATION PROGRESS + COMPLETION ENGINE
 * Runs on a schedule. Checks all characters' education items:
 * - Items past their completion_date with status='active' → mark completed
 * - Apply rewards: career qualifications, income boosts, skill tags
 * - Graduation: all full_school items completed → graduate
 * - Emotional impacts: pride, burnout, relief, confidence
 * - Creates rich Memory entries and life events
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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
      const eduItems = character.completed_education || [];
      if (!eduItems.length) continue;

      let changed = false;
      const updatedItems = [...eduItems];
      let newStudentStatus = character.student_status;

      for (let i = 0; i < updatedItems.length; i++) {
        const item = updatedItems[i];

        // ── STATUS-FIRST LOGIC ──────────────────────────────────────
        // Manual status always wins. Only auto-complete if status is
        // 'active' or 'enrolled' (or legacy unset) AND date has passed.
        const manuallyResolved = ['completed', 'dropped', 'paused', 'planned'].includes(item.status);
        if (manuallyResolved) continue;

        const isActivelyEnrolled = !item.status || item.status === 'active' || item.status === 'enrolled' || item.status === 'at_risk';
        if (!isActivelyEnrolled) continue;
        if (!item.completion_date) continue;

        // Date inference: if start_date is in the future → planned, skip
        if (item.start_date && new Date(item.start_date) > now) {
          if (item.status !== 'planned') {
            updatedItems[i] = { ...item, status: 'planned' };
            changed = true;
          }
          continue;
        }

        const completionDate = new Date(item.completion_date);
        if (now < completionDate) continue;

        // ── COMPLETION ───────────────────────────────────────────
        updatedItems[i] = { ...item, status: 'completed', progress: 100 };
        changed = true;

        const isCert = item.enrollment_type === 'certification';
        const isSchool = item.enrollment_type === 'full_school';
        const isCourse = item.enrollment_type === 'course' || !item.enrollment_type;

        // Emotional impact
        const emotion = isSchool ? 'pride' : isCert ? 'confidence' : 'satisfaction';
        const lifeEventTitle = isSchool
          ? `Graduated from ${item.institution || item.course_name}`
          : isCert
          ? `Earned certification: ${item.course_name}`
          : `Completed course: ${item.course_name}`;

        const lifeEventDesc = isSchool
          ? `After completing their program at ${item.institution || 'school'}, they graduated with a sense of pride and accomplishment. This opens doors to better career opportunities and higher income potential.`
          : isCert
          ? `Successfully earned the ${item.course_name} certification. This credential adds a verified skill to their profile and may qualify them for new roles or promotions.`
          : `Finished ${item.course_name}${item.institution ? ` through ${item.institution}` : ''}. Gained new knowledge and skills.`;

        // Create memory
        await base44.asServiceRole.entities.Memory.create({
          character_id: character.id,
          title: lifeEventTitle,
          description: lifeEventDesc,
          emotional_impact: emotion,
          lesson_learned: isSchool
            ? 'Education opens doors. The hard work paid off.'
            : isCert
            ? 'Building credentials creates real opportunity.'
            : 'Continuous learning is worth the effort.',
          timestamp: now.toISOString(),
          source_context: 'education_completion',
        });

        // Create life event
        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: character.id,
          character_name: character.name,
          event_type: 'life_milestone_event',
          valence: 'positive',
          severity: isSchool ? 'major' : isCert ? 'significant' : 'moderate',
          title: lifeEventTitle,
          description: lifeEventDesc,
          emotional_impact: emotion,
          triggered_by: 'life_simulation',
          systems_updated: ['education', 'mood', 'memory'],
          context_tags: ['education', item.mode || 'on_demand', item.enrollment_type || 'course'],
          timestamp: now.toISOString(),
        });

        // Apply rewards if defined
        if (item.rewards) {
          const charUpdates = {};
          // Income boost: add to current_situation text
          if (item.rewards.income_boost && item.rewards.income_boost > 0) {
            charUpdates.current_life_event = `Just completed ${item.course_name}! This could open up better-paying opportunities.`;
          }
          if (Object.keys(charUpdates).length > 0) {
            await base44.asServiceRole.entities.Character.update(character.id, charUpdates);
          }
        }

        // Graduation: if school, update student_status
        if (isSchool) {
          newStudentStatus = 'graduated';
          // Check if enrolled at school — update enrolled_students record
          if (item.location_id) {
            const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: item.location_id });
            if (locs[0]) {
              const updatedStudents = (locs[0].enrolled_students || []).map(s =>
                s.character_id === character.id ? { ...s, status: 'graduated' } : s
              );
              await base44.asServiceRole.entities.LocationReference.update(item.location_id, { enrolled_students: updatedStudents });
            }
          }
        }

        updates.push({
          characterId: character.id,
          characterName: character.name,
          type: item.enrollment_type || 'course',
          mode: item.mode || 'on_demand',
          courseName: item.course_name,
          action: 'completed',
          emotion,
        });
      }

      if (changed) {
        const finalUpdate = { completed_education: updatedItems };
        if (newStudentStatus !== character.student_status) {
          finalUpdate.student_status = newStudentStatus;
        }
        await base44.asServiceRole.entities.Character.update(character.id, finalUpdate);
      }

      // ── LEGACY FIELD CHECK (backwards compatibility) ──────────
      if (character.current_education_activity && character.current_education_activity !== 'none') {
        const legacyDate = new Date(character.education_expected_completion_date);
        if (now >= legacyDate) {
          const legacyEntry = {
            course_name: character.education_details?.course_name || character.current_education_activity,
            institution: character.education_details?.institution || '',
            enrollment_type: 'course',
            mode: 'on_demand',
            start_date: character.education_start_date || null,
            completion_date: now.toISOString(),
            status: 'completed',
            progress: 100,
          };

          const updatedCompleted = [...(character.completed_education || []), legacyEntry];
          await base44.asServiceRole.entities.Character.update(character.id, {
            current_education_activity: 'none',
            education_start_date: null,
            education_expected_completion_date: null,
            education_details: null,
            completed_education: updatedCompleted,
          });

          await base44.asServiceRole.entities.Memory.create({
            character_id: character.id,
            title: `Completed ${legacyEntry.course_name}`,
            description: `Finished ${legacyEntry.course_name}. Proud of sticking with it.`,
            emotional_impact: 'proud',
            lesson_learned: 'Commitment to learning pays off.',
            timestamp: now.toISOString(),
            source_context: 'education_completion',
          });

          updates.push({ characterId: character.id, type: 'legacy_course', action: 'completed' });
        }
      }

      if (character.current_job_training_activity && character.current_job_training_activity !== 'none') {
        const trainingDate = new Date(character.job_training_expected_completion_date);
        if (now >= trainingDate) {
          const training = {
            training_name: character.job_training_details?.training_name || character.current_job_training_activity,
            company: character.job_training_details?.company || '',
            position_title: character.job_training_details?.position_title || '',
            completion_date: now.toISOString(),
          };

          await base44.asServiceRole.entities.Character.update(character.id, {
            current_job_training_activity: 'none',
            job_training_start_date: null,
            job_training_expected_completion_date: null,
            job_training_details: null,
            completed_job_training: [...(character.completed_job_training || []), training],
            current_life_event: `Finished training for ${training.position_title} at ${training.company}! Ready to go.`,
          });

          await base44.asServiceRole.entities.Memory.create({
            character_id: character.id,
            title: `Completed training: ${training.position_title}`,
            description: `Finished job training at ${training.company} for ${training.position_title}.`,
            emotional_impact: 'confident',
            lesson_learned: 'Preparation makes the difference.',
            timestamp: now.toISOString(),
            source_context: 'job_training_completion',
          });

          updates.push({ characterId: character.id, type: 'job_training', action: 'completed' });
        }
      }
    }

    return Response.json({
      success: true,
      updatesProcessed: updates.length,
      updates,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});