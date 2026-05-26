import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, MapPin, Loader2, Check } from 'lucide-react';
import { format } from 'date-fns';

/**
 * CharacterEducationSection
 *
 * Source of truth:
 *   - Character.education_location_id / education_location_name → linked school
 *   - Character.education_enrollments[] → courses, each with optional in_person_location_id
 *   - LocationReference.enrolled_students[] → bidirectional sync
 *
 * All queries use owner_email — never created_by.
 */
export default function CharacterEducationSection({ character }) {
  const queryClient = useQueryClient();
  const [savingSchool, setSavingSchool] = useState(false);
  const [savedSchool, setSavedSchool] = useState(false);
  const [savingCourse, setSavingCourse] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  // Fetch all school/education locations owned by user
  const { data: schoolLocations = [] } = useQuery({
    queryKey: ['schoolLocations', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      const all = res?.data?.locations || [];
      return all.filter(l => l.category === 'school' || l.category === 'education');
    },
    enabled: !!currentUser?.email,
  });

  const handleSchoolChange = async (locationId) => {
    const loc = schoolLocations.find(l => l.id === locationId);
    setSavingSchool(true);
    setSavedSchool(false);
    try {
      const prevLocationId = character.education_location_id;

      // Update Character
      await base44.entities.Character.update(character.id, {
        education_location_id: locationId || null,
        education_location_name: loc?.name || null,
      });

      // Remove from previous school's enrolled_students if switching
      if (prevLocationId && prevLocationId !== locationId) {
        const prevLoc = await base44.entities.LocationReference.filter({ id: prevLocationId });
        if (prevLoc?.[0]) {
          const updatedStudents = (prevLoc[0].enrolled_students || []).filter(
            s => s.character_id !== character.id
          );
          await base44.entities.LocationReference.update(prevLocationId, { enrolled_students: updatedStudents });
        }
      }

      // Add to new school's enrolled_students
      if (locationId && loc) {
        const currentStudents = loc.enrolled_students || [];
        const alreadyEnrolled = currentStudents.some(s => s.character_id === character.id);
        if (!alreadyEnrolled) {
          await base44.entities.LocationReference.update(locationId, {
            enrolled_students: [
              ...currentStudents,
              {
                character_id: character.id,
                character_name: character.name,
                enroll_date: new Date().toISOString(),
                status: 'active',
                tuition_amount: loc.tuition_cost || 0,
              },
            ],
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      queryClient.invalidateQueries({ queryKey: ['locationReferences', currentUser?.email] });
      setSavedSchool(true);
      setTimeout(() => setSavedSchool(false), 2000);
    } catch (err) {
      console.error('[CharacterEducationSection] school change error:', err);
    } finally {
      setSavingSchool(false);
    }
  };

  const handleCourseLocationChange = async (courseIdx, locationId) => {
    setSavingCourse(courseIdx);
    const loc = schoolLocations.find(l => l.id === locationId);
    try {
      const enrollments = [...(character.education_enrollments || [])];
      enrollments[courseIdx] = {
        ...enrollments[courseIdx],
        in_person_location_id: locationId || null,
        in_person_location_name: loc?.name || null,
      };
      await base44.entities.Character.update(character.id, { education_enrollments: enrollments });
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
    } catch (err) {
      console.error('[CharacterEducationSection] course location error:', err);
    } finally {
      setSavingCourse(null);
    }
  };

  const completedItems = (character.completed_education || []).filter(edu => {
    if (!edu.completion_date) return false;
    return new Date(edu.completion_date) <= new Date();
  });

  const activeEnrollments = (character.education_enrollments || []).filter(e => e.status !== 'graduated' && e.status !== 'dropped');

  const isSchoolCat = character.student_status === 'enrolled' || activeEnrollments.length > 0 || character.education_location_id;

  return (
    <div className="space-y-4">
      {/* School Location Picker */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-amber-400" />
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider">School / Institution Location</label>
          {savedSchool && <Check className="w-3.5 h-3.5 text-emerald-400" />}
          {savingSchool && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-xs text-muted-foreground">Link to an actual school location in your app. This will add the character as a student on that location.</p>
        <select
          value={character.education_location_id || ''}
          onChange={e => handleSchoolChange(e.target.value || null)}
          disabled={savingSchool}
          className="w-full h-9 rounded-lg bg-card border border-border px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
        >
          <option value="">— No school location linked —</option>
          {schoolLocations.map(loc => (
            <option key={loc.id} value={loc.id}>{loc.name}</option>
          ))}
        </select>
        {character.education_location_name && (
          <p className="text-xs text-amber-400 font-medium">📍 Currently linked: {character.education_location_name}</p>
        )}
        {schoolLocations.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No school/education locations found. Add one in the Places tab.</p>
        )}
      </div>

      {/* Active Courses */}
      {activeEnrollments.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Active Courses</p>
          {activeEnrollments.map((course, idx) => {
            const actualIdx = (character.education_enrollments || []).indexOf(course);
            const isInPerson = course.mode === 'in_person' || course.must_attend;
            return (
              <div key={idx} className="bg-secondary/40 rounded-xl border border-border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{course.course_name || course.program_name || 'Course'}</p>
                    {course.institution && <p className="text-xs text-muted-foreground">{course.institution}</p>}
                  </div>
                  {course.mode && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border capitalize flex-shrink-0">
                      {course.mode?.replace('_', ' ')}
                    </span>
                  )}
                </div>

                {/* In-person school location dropdown */}
                {isInPerson && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-amber-400" />
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Attends at School Location</label>
                      {savingCourse === actualIdx && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                    </div>
                    <select
                      value={course.in_person_location_id || ''}
                      onChange={e => handleCourseLocationChange(actualIdx, e.target.value || null)}
                      disabled={savingCourse === actualIdx}
                      className="w-full h-8 rounded-lg bg-card border border-border px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                    >
                      <option value="">— Select school location —</option>
                      {schoolLocations.map(loc => (
                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                      ))}
                    </select>
                    {course.in_person_location_name && (
                      <p className="text-[10px] text-amber-400">📍 {course.in_person_location_name}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Completed Education */}
      {completedItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Completed Education</p>
          </div>
          <div className="space-y-1">
            {completedItems.map((edu, idx) => {
              const modeLabel = edu.mode === 'in_person' ? 'In-Person' : edu.mode === 'remote_scheduled' ? 'Remote' : edu.mode === 'on_demand' ? 'On-Demand' : null;
              return (
                <div key={idx}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-muted-foreground">
                      {edu.course_name}{edu.institution ? ` — ${edu.institution}` : ''}
                    </p>
                    {modeLabel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{modeLabel}</span>
                    )}
                  </div>
                  {edu.completion_date && (
                    <p className="text-xs text-muted-foreground/60">
                      Completed {format(new Date(edu.completion_date), 'MMM yyyy')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isSchoolCat && completedItems.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No education data yet. Link a school location above or enroll in a course via the Edit Character Profile page.</p>
      )}
    </div>
  );
}