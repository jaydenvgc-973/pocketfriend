import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, GraduationCap, DollarSign, Award, Trash2, Home, Pencil, Check, X, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import CharacterAvatar from '@/components/chat/CharacterAvatar';
import { isEligibleSchoolHousingResident } from '@/lib/residentialUnits';
import StudentWorkSchedule from '@/components/location/StudentWorkSchedule';

/**
 * SchoolEnrollmentSection — PENCIL/EDIT DROPDOWN ONLY
 *
 * Editable enrollment management for school/education locations.
 * Writes to:
 *   - LocationReference.enrolled_students[]
 *   - LocationReference.residents[] (if lives_on_campus)
 *   - Character.education_enrollments[] / education_location_id
 *   - Character.current_home_location_id (if lives_on_campus)
 *
 * All queries use owner_email — never created_by.
 */
// SCHOOL TYPE RESIDENCY RULE — mirrors campusResidencyResolver.js and campusResidencyGuard.
//
// NON-RESIDENTIAL (no campus residency option, warning shown):
//   daycare_preschool, elementary_school, high_school
//
// ALWAYS RESIDENTIAL (forced residential, toggle hidden):
//   boarding_school
//
// USER CHOICE (Residential / Non-residential toggle shown):
//   college, university
//
const NON_RESIDENTIAL_SCHOOL_TYPES = ['daycare_preschool', 'elementary_school', 'high_school', 'private_school', 'language_school', 'music_school', 'online_school'];
const ALWAYS_RESIDENTIAL_SCHOOL_TYPES = ['boarding_school'];

/**
 * Returns 'non_residential' | 'always_residential' | 'user_choice'
 */
function getResidencyMode(location) {
  const t = location?.school_type;
  if (!t) return 'user_choice';
  if (NON_RESIDENTIAL_SCHOOL_TYPES.includes(t)) return 'non_residential';
  if (ALWAYS_RESIDENTIAL_SCHOOL_TYPES.includes(t)) return 'always_residential';
  // college, university, trade_school, other
  return 'user_choice';
}

/**
 * ACADEMIC SCHEDULE — colleges and universities only.
 *
 * Each enrolled student keeps their own class days and hours on their enrollment record.
 * A day that is not selected has no class; an empty schedule means no schedule has been
 * established. Neither is ever replaced by the institution's operating hours, a default
 * week, or another student's hours.
 */
const ACADEMIC_SCHEDULE_SCHOOL_TYPES = ['college', 'university'];
const ACADEMIC_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_CLASS_HOURS = { start_time: '09:00', end_time: '12:00' };

function usesAcademicSchedule(location) {
  if (!location) return false;
  // The location's existing venue types are kept in `subtype`; `school_type` is the other
  // existing field the same distinction can be recorded in. Either one qualifies — never
  // both required, and no other venue type (high school, elementary, trade) does.
  const venueTypes = [
    ...(Array.isArray(location.subtype) ? location.subtype : []),
    location.school_type,
  ].map((t) => String(t || '').toLowerCase());
  return venueTypes.some((t) => ACADEMIC_SCHEDULE_SCHOOL_TYPES.includes(t));
}

/** Stored schedule array → { dayOfWeek: { start_time, end_time } } for editing. */
function scheduleToDayMap(schedule) {
  const map = {};
  for (const entry of (Array.isArray(schedule) ? schedule : [])) {
    if (entry && entry.day_of_week != null && entry.start_time && entry.end_time) {
      map[entry.day_of_week] = { start_time: entry.start_time, end_time: entry.end_time };
    }
  }
  return map;
}

/** { dayOfWeek: { start_time, end_time } } → stored schedule array, ordered Sun→Sat. */
function dayMapToSchedule(map) {
  return Object.keys(map || {})
    .map(Number)
    .sort((a, b) => a - b)
    .filter((day) => map[day]?.start_time && map[day]?.end_time)
    .map((day) => ({ day_of_week: day, start_time: map[day].start_time, end_time: map[day].end_time }));
}

/** The student's own class days and hours, read from their enrollment record for this school. */
function studentAcademicSchedule(char, location) {
  if (!char || !location) return [];
  const entries = Array.isArray(char.education_enrollments) ? char.education_enrollments : [];
  const forSchool = entries.filter((e) => !!e
    && (e.location_id === location.id || e.in_person_location_id === location.id));
  const hasDays = (e) => Array.isArray(e.academic_schedule)
    && e.academic_schedule.some((d) => d && d.start_time && d.end_time);
  // The active record is this student's enrollment. A schedule established before an
  // earlier drop/re-enroll still belongs to the same student at the same school, so it is
  // shown instead of reporting "no classes" while it sits on the older record.
  const active = forSchool.find((e) => e.status === 'active');
  if (active && hasDays(active)) return active.academic_schedule;
  const withDays = forSchool.find(hasDays);
  if (withDays) return withDays.academic_schedule;
  return active && Array.isArray(active.academic_schedule) ? active.academic_schedule : [];
}

function formatClassTime(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export default function SchoolEnrollmentSection({ location, onUpdate }) {
  // The same residency test the housing section uses: enrollment with campus residency,
  // or the school already being the character's home. Read only.

  const queryClient = useQueryClient();
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [selectedCharIds, setSelectedCharIds] = useState(new Set());
  const [scholarshipEnabled, setScholarshipEnabled] = useState(false);
  const residencyMode = getResidencyMode(location);
  // boarding_school always starts as residential; non-residential types always false
  const [livesOnCampus, setLivesOnCampus] = useState(residencyMode === 'always_residential');
  const [enrolling, setEnrolling] = useState(false);
  const [programName, setProgramName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [enrollmentType, setEnrollmentType] = useState('full_school');
  const [enrollError, setEnrollError] = useState('');
  // Academic schedule being established for the characters enrolled in this action.
  // { dayOfWeek: { start_time, end_time } } — only selected days have class.
  const [enrollSchedule, setEnrollSchedule] = useState({});
  const academicScheduling = usesAcademicSchedule(location);

  const toggleChar = (id) => setSelectedCharIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const [active, npcs] = await Promise.all([
        base44.entities.Character.filter({ owner_email: currentUser.email, status: 'active', character_type: 'active_created_character' }),
        base44.entities.Character.filter({ owner_email: currentUser.email, character_type: { $in: ['npc_fictitious', 'npc_family_member'] } }),
      ]);
      const seen = new Set();
      return [...active, ...npcs.filter(c => c.status !== 'deleted' && c.status !== 'moved_away')].filter(c => {
        if (seen.has(c.id)) return false; seen.add(c.id); return true;
      });
    },
    enabled: !!currentUser?.email,
  });

  const enrolledCharIds = (location.enrolled_students || [])
    .filter(s => s.status === 'active')
    .map(s => s.character_id);

  const availableCharacters = characters.filter(c => !enrolledCharIds.includes(c.id));

  const handleEnroll = async () => {
    if (selectedCharIds.size === 0) return;
    const resolvedCourseName = programName.trim() || location.name;
    // College/university enrollments carry this student's own class days and hours.
    // No schedule established here stays empty — never a default week.
    const academicSchedule = academicScheduling ? dayMapToSchedule(enrollSchedule) : null;
    setEnrolling(true);
    setEnrollError('');
    try {
      // Enforce residency mode at the UI layer — backend also enforces this
      const effectiveLivesOnCampus =
        residencyMode === 'always_residential' ? true :
        residencyMode === 'non_residential' ? false :
        livesOnCampus;

      const results = await Promise.allSettled([...selectedCharIds].map(charId =>
        base44.functions.invoke('enrollCharacterInSchool', {
          character_id: charId,
          location_id: location.id,
          enrollment_type: enrollmentType,
          mode: enrollmentType === 'full_school' ? 'in_person' : 'on_demand',
          course_name: resolvedCourseName,
          institution: location.name,
          scholarship_enabled: scholarshipEnabled,
          start_date: startDate || null,
          end_date: endDate || null,
          lives_on_campus: effectiveLivesOnCampus,
          academic_schedule: academicSchedule,
        })
      ));
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        const msg = failures[0].reason?.response?.data?.error || failures[0].reason?.message || 'Enrollment failed';
        setEnrollError(msg);
      }

      // If lives on campus, also update location residents and character home
      let newResidents = [...(location.residents || [])];
      if (effectiveLivesOnCampus && failures.length === 0) {
        const toAdd = characters.filter(c => selectedCharIds.has(c.id));
        toAdd.forEach(char => {
          if (!newResidents.some(r => r.character_id === char.id)) {
            newResidents.push({ character_id: char.id, character_name: char.name, moved_in_date: new Date().toISOString() });
          }
        });
        await base44.entities.LocationReference.update(location.id, { residents: newResidents });
        await Promise.all(toAdd.map(char =>
          base44.entities.Character.update(char.id, { current_home_location_id: location.id })
        ));
      }

      if (failures.length === 0) {
        // Build the updated students list locally — do NOT re-fetch from DB (cache returns stale data)
        const nowIso = new Date().toISOString();
        const newlyEnrolled = characters
          .filter(c => selectedCharIds.has(c.id))
          .map(char => ({
            character_id: char.id,
            character_name: char.name,
            enroll_date: nowIso,
            start_date: startDate ? new Date(startDate).toISOString() : null,
            end_date: endDate ? new Date(endDate).toISOString() : null,
            course_name: resolvedCourseName,
            institution: location.name,
            enrollment_type: enrollmentType,
            scholarship_enabled: scholarshipEnabled,
            tuition_amount: scholarshipEnabled ? 0 : (location.tuition_cost || 0),
            lives_on_campus: effectiveLivesOnCampus,
            status: 'active',
          }));

        const updatedStudents = [...(location.enrolled_students || []), ...newlyEnrolled];

        // Patch character cache immediately
        const charCacheKey = ['characters', currentUser?.email];
        const cachedChars = queryClient.getQueryData(charCacheKey);
        if (Array.isArray(cachedChars)) {
          const enrolledIds = [...selectedCharIds];
          const patchedChars = cachedChars.map(c => {
            if (!enrolledIds.includes(c.id)) return c;
            return {
              ...c,
              education_location_id: c.education_location_id || location.id,
              education_location_name: c.education_location_name || location.name,
              current_school_location_id: location.id,
              student_status: 'enrolled',
              ...(effectiveLivesOnCampus ? { current_home_location_id: location.id } : {}),
            };
          });
          queryClient.setQueryData(charCacheKey, patchedChars);
        }

        queryClient.invalidateQueries({ queryKey: ['locationReferences'] });
        queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });

        setShowAddStudent(false);
        setSelectedCharIds(new Set());
        setScholarshipEnabled(false);
        setLivesOnCampus(false);
        setProgramName('');
        setStartDate('');
        setEndDate('');
        setEnrollmentType('full_school');
        setEnrollSchedule({});
        setEnrollError('');
        onUpdate?.(updatedStudents, newResidents);
      }
    } catch (err) {
      setEnrollError(err.message || 'Enrollment failed');
    } finally {
      setEnrolling(false);
    }
  };

  const handleUnenroll = async (charId, reason = 'dropped') => {
    if (!window.confirm(`${reason === 'graduated' ? 'Graduate' : 'Remove'} this student?`)) return;

    // If student lives on campus, remove from residents too
    const isOnCampus = (location.residents || []).some(r => r.character_id === charId);

    try {
      await base44.functions.invoke('unenrollCharacterFromSchool', {
        character_id: charId,
        location_id: location.id,
        reason,
      });

      // Build updated lists locally — do NOT re-fetch from DB (cache returns stale data)
      const updatedStudents = (location.enrolled_students || []).map(s =>
        s.character_id === charId ? { ...s, status: reason === 'graduated' ? 'graduated' : 'dropped' } : s
      );

      let newResidents = [...(location.residents || [])];
      if (isOnCampus) {
        newResidents = newResidents.filter(r => r.character_id !== charId);
        await base44.entities.LocationReference.update(location.id, { residents: newResidents });
        const char = characters.find(c => c.id === charId);
        if (char?.current_home_location_id === location.id) {
          await base44.entities.Character.update(charId, { current_home_location_id: null });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['locationReferences'] });
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      onUpdate?.(updatedStudents, newResidents);
    } catch (err) {
      console.error('Unenroll error:', err);
    }
  };

  // Per-student edit state
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editFields, setEditFields] = useState({});
  // A save that fails must say so. A rejected write used to disappear silently, which
  // looks exactly like "the schedule did not save".
  const [saveError, setSaveError] = useState('');

  const startEdit = (student) => {
    setEditingStudentId(student.character_id);
    setEditFields({
      course_name: student.course_name || '',
      enroll_date: student.enroll_date ? new Date(student.enroll_date).toISOString().slice(0, 10) : '',
      start_date: student.start_date ? new Date(student.start_date).toISOString().slice(0, 10) : '',
      end_date: student.end_date ? new Date(student.end_date).toISOString().slice(0, 10) : '',
      scholarship_enabled: student.scholarship_enabled || false,
      lives_on_campus: student.lives_on_campus || false,
      // Read from this student's own enrollment record — the location roster does not keep it.
      academic_schedule: scheduleToDayMap(
        studentAcademicSchedule(characters.find(c => c.id === student.character_id), location)
      ),
    });
  };

  const cancelEdit = () => { setEditingStudentId(null); setEditFields({}); };

  const saveEdit = async (student) => {
    const newCourseName = editFields.course_name || student.course_name;
    const newEnrollDate = editFields.enroll_date ? new Date(editFields.enroll_date).toISOString() : student.enroll_date;
    const newStartDate = editFields.start_date ? new Date(editFields.start_date).toISOString() : student.start_date;
    const newEndDate = editFields.end_date ? new Date(editFields.end_date).toISOString() : student.end_date;
    const newScholarship = editFields.scholarship_enabled;
    const newLivesOnCampus = editFields.lives_on_campus || false;
    const prevLivesOnCampus = student.lives_on_campus || false;

    // 1. Update LocationReference.enrolled_students — always persist lives_on_campus
    const updatedStudents = (location.enrolled_students || []).map(s =>
      s.character_id === student.character_id
        ? {
            ...s,
            course_name: newCourseName,
            enroll_date: newEnrollDate,
            start_date: newStartDate,
            end_date: newEndDate,
            scholarship_enabled: newScholarship,
            tuition_amount: newScholarship ? 0 : (location.tuition_cost || 0),
            lives_on_campus: newLivesOnCampus,
          }
        : s
    );
    await base44.entities.LocationReference.update(location.id, { enrolled_students: updatedStudents });

    // 2. Sync campus residency change to Location.residents and Character.current_home_location_id
    const char = characters.find(c => c.id === student.character_id);
    if (char && newLivesOnCampus !== prevLivesOnCampus) {
      let newResidents = [...(location.residents || [])];
      if (newLivesOnCampus) {
        // Adding to campus — set character home to school location
        if (!newResidents.some(r => r.character_id === char.id)) {
          newResidents.push({ character_id: char.id, character_name: char.name, moved_in_date: new Date().toISOString() });
        }
        await base44.entities.LocationReference.update(location.id, { residents: newResidents });
        await base44.entities.Character.update(char.id, { current_home_location_id: location.id });
      } else {
        // Removing from campus — restore home only if currently pointing to this school
        newResidents = newResidents.filter(r => r.character_id !== char.id);
        await base44.entities.LocationReference.update(location.id, { residents: newResidents });
        if (char.current_home_location_id === location.id) {
          await base44.entities.Character.update(char.id, { current_home_location_id: null });
        }
      }
    }

    // 3. Sync dates back to Character.education_enrollments[] and Character.completed_education[]
    // This keeps the character profile education section in sync with the location page.
    if (char) {
      // CRITICAL: lives_on_campus must be synced back to Character.education_enrollments[]
      // so campusResidencyGuard reads the correct value from the Character record.
      const syncFields = {
        course_name: newCourseName,
        enroll_date: newEnrollDate,
        start_date: newStartDate,
        completion_date: newEndDate,
        end_date: newEndDate,
        scholarship_enabled: newScholarship,
        lives_on_campus: newLivesOnCampus,
      };
      // This student's own class days and hours belong on their enrollment record.
      if (academicScheduling) {
        syncFields.academic_schedule = dayMapToSchedule(editFields.academic_schedule);
      }

      // Helper: patch matching enrollment entry in an array
      const patchArray = (arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const matchesSchool = (e) => !!e && (
          e.location_id === location.id ||
          e.in_person_location_id === location.id ||
          (e.course_name && e.course_name === (student.course_name || location.name))
        );
        // The ACTIVE entry is the one the roster reads, so it is the one a save must
        // change. A previous drop/graduation leaves an older entry for the same school;
        // patching that one saved nothing the roster could ever show.
        let idx = arr.findIndex(e => matchesSchool(e) && e.status === 'active');
        if (idx === -1) idx = arr.findIndex(matchesSchool);
        if (idx === -1) return null;
        const patched = [...arr];
        patched[idx] = { ...patched[idx], ...syncFields, status: 'active' };
        return patched;
      };

      let patchedEnrollments = patchArray(char.education_enrollments);
      // A student enrolled before this record existed has no entry to patch — one is
      // created here so the schedule the user just set is not silently lost.
      if (academicScheduling && !patchedEnrollments) {
        patchedEnrollments = [
          ...(Array.isArray(char.education_enrollments) ? char.education_enrollments : []),
          {
            location_id: location.id,
            location_name: location.name,
            status: 'active',
            ...syncFields,
          },
        ];
      }
      const patchedCompleted = patchArray(char.completed_education);

      const charUpdate = {};
      if (patchedEnrollments) charUpdate.education_enrollments = patchedEnrollments;
      if (patchedCompleted) charUpdate.completed_education = patchedCompleted;
      if (Object.keys(charUpdate).length > 0) {
        await base44.entities.Character.update(char.id, charUpdate);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['locationReferences'] });
    queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
    onUpdate?.(updatedStudents, location.residents || []);
    cancelEdit();
  };

  const tuitionDisplay = location.tuition_cost || 0;
  const frequencyDisplay = location.tuition_frequency || 'annual';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Students</h3>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddStudent(!showAddStudent)}
          className="h-8 gap-1 text-xs rounded-lg"
        >
          <Plus className="w-3.5 h-3.5" /> Enroll
        </Button>
      </div>

      {/* Enrollment Form */}
      <AnimatePresence>
        {showAddStudent && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-secondary/40 rounded-xl border border-border p-3 space-y-3">

              {/* Program Name */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground uppercase tracking-wider block">Program / Course Name</label>
                <input
                  type="text"
                  value={programName}
                  onChange={e => setProgramName(e.target.value)}
                  placeholder={location.name}
                  className="w-full h-8 px-3 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="text-xs text-muted-foreground">Leave blank to use school name</p>
              </div>

              {/* Enrollment Type */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground uppercase tracking-wider block">Enrollment Type</label>
                <div className="flex gap-2">
                  {[
                    { value: 'full_school', label: 'Full School' },
                    { value: 'course', label: 'Course' },
                    { value: 'certification', label: 'Certification' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setEnrollmentType(opt.value)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        enrollmentType === opt.value
                          ? 'bg-primary/10 border-primary/50 text-primary'
                          : 'bg-card border-border text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Start / End Dates */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider block">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full h-8 px-2 rounded-lg bg-card border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider block">Expected Graduation</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full h-8 px-2 rounded-lg bg-card border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>

              {/* Academic Schedule — colleges and universities only */}
              {academicScheduling && (
                <div className="p-3 rounded-xl border border-border bg-card space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-foreground">Academic Schedule</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This student's own class days and hours. Unselected days have no classes — the school's active hours are never used instead.
                  </p>
                  <div className="flex gap-1.5 flex-wrap">
                    {ACADEMIC_DAY_LABELS.map((label, day) => {
                      const active = enrollSchedule[day] != null;
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setEnrollSchedule(prev => {
                            const next = { ...prev };
                            if (next[day]) delete next[day];
                            else next[day] = { ...DEFAULT_CLASS_HOURS };
                            return next;
                          })}
                          className={`w-8 h-8 rounded-full text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-card border-border text-muted-foreground hover:border-primary/40'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {Object.keys(enrollSchedule).length === 0 ? (
                    <p className="text-xs text-muted-foreground/70 italic">No class days selected — no scheduled academic attendance.</p>
                  ) : (
                    Object.keys(enrollSchedule).map(Number).sort((a, b) => a - b).map(day => (
                      <div key={day} className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground w-8">{ACADEMIC_DAY_LABELS[day]}</span>
                        <input
                          type="time"
                          value={enrollSchedule[day].start_time}
                          onChange={e => setEnrollSchedule(prev => ({ ...prev, [day]: { ...prev[day], start_time: e.target.value } }))}
                          className="flex-1 h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <input
                          type="time"
                          value={enrollSchedule[day].end_time}
                          onChange={e => setEnrollSchedule(prev => ({ ...prev, [day]: { ...prev[day], end_time: e.target.value } }))}
                          className="flex-1 h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Work schedules of the characters selected for this enrollment — shown
                  directly under the academic schedule so a shift conflict is visible
                  before enrolling. Read-only. */}
              {academicScheduling && selectedCharIds.size > 0 && (
                <div className="space-y-1.5">
                  {characters.filter(c => selectedCharIds.has(c.id)).map(c => (
                    <div key={c.id} className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">{c.name}</p>
                      <StudentWorkSchedule character={c} />
                    </div>
                  ))}
                </div>
              )}

              {/* Character Selector */}
              <label className="text-xs text-muted-foreground uppercase tracking-wider block">
                Select Characters ({selectedCharIds.size} selected)
              </label>
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {availableCharacters.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">No characters available</p>
                )}
                {availableCharacters.map(char => {
                  const isSelected = selectedCharIds.has(char.id);
                  return (
                    <button
                      key={char.id}
                      onClick={() => toggleChar(char.id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-colors text-left ${
                        isSelected ? 'bg-primary/10 border-primary/50' : 'bg-card border-border hover:border-primary/30'
                      }`}
                    >
                      <CharacterAvatar character={char} size="sm" />
                      <span className="text-sm font-medium text-foreground flex-1 truncate">{char.name}</span>
                      <div className={`w-4 h-4 rounded flex-shrink-0 border-2 transition-colors flex items-center justify-center ${
                        isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                      }`}>
                        {isSelected && <div className="w-2 h-2 rounded-sm bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Scholarship */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scholarshipEnabled}
                  onChange={(e) => setScholarshipEnabled(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-foreground">Scholarship (free tuition) — applies to all selected</span>
              </label>

              {/* Campus Residency — three modes based on school type */}
              {residencyMode === 'user_choice' && (
                <div className="p-3 rounded-xl border border-border bg-card space-y-2">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-medium text-foreground">Campus Residency</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setLivesOnCampus(true)}
                      className={`flex-1 py-2 rounded-lg text-xs border transition-colors ${
                        livesOnCampus ? 'bg-blue-500/10 border-blue-500/50 text-blue-400' : 'bg-card border-border text-muted-foreground hover:border-blue-500/30'
                      }`}
                    >
                      Residential
                    </button>
                    <button
                      onClick={() => setLivesOnCampus(false)}
                      className={`flex-1 py-2 rounded-lg text-xs border transition-colors ${
                        !livesOnCampus ? 'bg-secondary border-border text-foreground' : 'bg-card border-border text-muted-foreground hover:border-border'
                      }`}
                    >
                      Non-residential
                    </button>
                  </div>
                  {livesOnCampus && (
                    <p className="text-xs text-blue-400/80">
                      Character will be added as a campus resident and their home location set to this school.
                    </p>
                  )}
                </div>
              )}
              {residencyMode === 'always_residential' && (
                <div className="p-2.5 rounded-xl border border-blue-500/30 bg-blue-500/5 flex items-center gap-2">
                  <Home className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                  <p className="text-xs text-blue-400">Boarding school — all students are Residential. Character's home will be set to this school.</p>
                </div>
              )}
              {residencyMode === 'non_residential' && (
                <div className="p-2.5 rounded-xl border border-border bg-secondary/30 flex items-center gap-2">
                  <Home className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">Campus residency not available — this school type is non-residential. Students live at their own assigned home.</p>
                </div>
              )}

              {enrollError && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{enrollError}</p>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleEnroll}
                  disabled={selectedCharIds.size === 0 || enrolling}
                  className="flex-1 h-9 rounded-lg text-sm"
                >
                  {enrolling ? 'Enrolling...' : `Enroll ${selectedCharIds.size > 0 ? `(${selectedCharIds.size})` : ''}`}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setShowAddStudent(false); setSelectedCharIds(new Set()); }}
                  className="flex-1 h-9 rounded-lg text-sm"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tuition Info */}
      <div className="bg-secondary/30 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <span className="text-muted-foreground">Tuition ({frequencyDisplay})</span>
          </div>
          <span className="font-semibold text-foreground">${tuitionDisplay}</span>
        </div>
      </div>

      {/* Enrolled Student List */}
      <div className="space-y-2">
        {(location.enrolled_students || []).filter(s => s.status === 'active').length > 0 ? (
          (location.enrolled_students || [])
            .filter(s => s.status === 'active')
            .map((student, idx) => {
              const char = characters.find(c => c.id === student.character_id);
              // Campus residency truth: read from saved enrollment record, not from residents array
              // (residents array is a secondary sync; the enrollment record is the source of truth)
              // An established campus residence is never displayed as Non-residential just
              // because an older enrollment row has not captured the flag: the character's own
              // active enrollment and established home are read here. Nothing is rewritten.
              const isOnCampus = student.lives_on_campus === true
                || (!!char && isEligibleSchoolHousingResident(char, location));
              const isEditing = editingStudentId === student.character_id;
              // This student's own class days and hours, read from their enrollment record.
              const studentSchedule = academicScheduling ? studentAcademicSchedule(char, location) : [];
              return (
                <div key={idx} className="bg-card border border-border rounded-xl p-3 space-y-2">
                  {/* Header row — always visible */}
                  <div className="flex items-center gap-3">
                    {char
                      ? <CharacterAvatar character={char} size="sm" />
                      : <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">{(student.character_name || '?')[0]}</div>
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{student.character_name}</p>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        {student.scholarship_enabled && (
                          <div className="flex items-center gap-1">
                            <Award className="w-3 h-3 text-yellow-400" />
                            <span className="text-xs text-yellow-400">Scholarship</span>
                          </div>
                        )}
                        {/* Campus residency badge */}
                        <span className={`text-xs flex items-center gap-1 px-1.5 py-0.5 rounded-md border ${
                          isOnCampus
                            ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
                            : 'text-muted-foreground bg-secondary/50 border-border'
                        }`}>
                          <Home className="w-3 h-3" />
                          {residencyMode === 'non_residential'
                            ? 'Non-residential'
                            : (isOnCampus ? 'Residential' : 'Non-residential')
                          }
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <div className="text-right mr-1">
                        <p className="text-xs text-muted-foreground">Monthly</p>
                        <p className="text-sm font-semibold text-foreground">
                          ${student.scholarship_enabled ? 0 : (student.tuition_amount || 0).toFixed(2)}
                        </p>
                      </div>
                      {!isEditing && (
                        <button
                          onClick={() => startEdit(student)}
                          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit enrollment"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Read-only dates (shown when not editing) */}
                  {!isEditing && (
                    <>
                      {student.course_name && student.course_name !== location.name && (
                        <p className="text-[10px] text-primary/80 font-medium">📚 {student.course_name}</p>
                      )}
                      {/* Academic schedule — this student's own class days and hours */}
                      {academicScheduling && (
                        <div className="rounded-lg bg-secondary/40 px-2 py-1.5">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Academic Schedule</p>
                          {studentSchedule.some(d => d && d.start_time && d.end_time) ? (
                            <div className="space-y-0.5">
                              {[...studentSchedule]
                                .filter(d => d && d.start_time && d.end_time)
                                .sort((a, b) => a.day_of_week - b.day_of_week)
                                .map(d => (
                                  <p key={d.day_of_week} className="text-[10px] text-foreground font-medium">
                                    {ACADEMIC_DAY_LABELS[d.day_of_week]} · {formatClassTime(d.start_time)}–{formatClassTime(d.end_time)}
                                  </p>
                                ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground/60 italic">No classes scheduled</p>
                          )}
                        </div>
                      )}
                      {/* Existing work assignments — shown directly under the academic
                          schedule so a class window that conflicts with a shift is visible. */}
                      {academicScheduling && <StudentWorkSchedule character={char} />}
                      <div className="grid grid-cols-3 gap-1 mt-1">
                        <div className="bg-secondary/40 rounded-lg px-2 py-1.5">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Enrolled</p>
                          <p className="text-[10px] text-foreground font-medium">
                            {student.enroll_date
                              ? new Date(student.enroll_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              : <span className="text-muted-foreground/50 italic">Not set</span>}
                          </p>
                        </div>
                        <div className="bg-secondary/40 rounded-lg px-2 py-1.5">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Start</p>
                          <p className="text-[10px] text-foreground font-medium">
                            {student.start_date
                              ? new Date(student.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              : <span className="text-muted-foreground/50 italic">Not set</span>}
                          </p>
                        </div>
                        <div className="bg-secondary/40 rounded-lg px-2 py-1.5">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Graduates</p>
                          <p className="text-[10px] text-foreground font-medium">
                            {student.end_date
                              ? new Date(student.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              : <span className="text-muted-foreground/50 italic">Not set</span>}
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Inline edit form */}
                  {isEditing && (
                    <div className="space-y-2 pt-1 border-t border-border">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground uppercase tracking-wider block">Program / Course</label>
                        <input
                          type="text"
                          value={editFields.course_name}
                          onChange={e => setEditFields(p => ({ ...p, course_name: e.target.value }))}
                          placeholder={location.name}
                          className="w-full h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground uppercase tracking-wider block">Enrollment Date</label>
                          <input
                            type="date"
                            value={editFields.enroll_date}
                            onChange={e => setEditFields(p => ({ ...p, enroll_date: e.target.value }))}
                            className="w-full h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground uppercase tracking-wider block">Start Date</label>
                          <input
                            type="date"
                            value={editFields.start_date}
                            onChange={e => setEditFields(p => ({ ...p, start_date: e.target.value }))}
                            className="w-full h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground uppercase tracking-wider block">Graduation</label>
                          <input
                            type="date"
                            value={editFields.end_date}
                            onChange={e => setEditFields(p => ({ ...p, end_date: e.target.value }))}
                            className="w-full h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                          />
                        </div>
                      </div>
                      {/* Academic schedule — this student's own class days and hours */}
                      {academicScheduling && (
                        <div className="p-2.5 rounded-xl border border-border bg-card space-y-2">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-primary" />
                            <span className="text-xs font-medium text-foreground">Academic Schedule</span>
                          </div>
                          <div className="flex gap-1.5 flex-wrap">
                            {ACADEMIC_DAY_LABELS.map((label, day) => {
                              const active = editFields.academic_schedule?.[day] != null;
                              return (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => setEditFields(p => {
                                    const next = { ...(p.academic_schedule || {}) };
                                    if (next[day]) delete next[day];
                                    else next[day] = { ...DEFAULT_CLASS_HOURS };
                                    return { ...p, academic_schedule: next };
                                  })}
                                  className={`w-7 h-7 rounded-full text-[10px] font-medium border transition-colors ${
                                    active
                                      ? 'bg-primary text-primary-foreground border-primary'
                                      : 'bg-card border-border text-muted-foreground hover:border-primary/40'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          {Object.keys(editFields.academic_schedule || {}).map(Number).sort((a, b) => a - b).map(day => (
                            <div key={day} className="flex items-center gap-2">
                              <span className="text-xs font-medium text-foreground w-8">{ACADEMIC_DAY_LABELS[day]}</span>
                              <input
                                type="time"
                                value={editFields.academic_schedule[day].start_time}
                                onChange={e => setEditFields(p => ({
                                  ...p,
                                  academic_schedule: { ...p.academic_schedule, [day]: { ...p.academic_schedule[day], start_time: e.target.value } },
                                }))}
                                className="flex-1 h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                              />
                              <span className="text-xs text-muted-foreground">to</span>
                              <input
                                type="time"
                                value={editFields.academic_schedule[day].end_time}
                                onChange={e => setEditFields(p => ({
                                  ...p,
                                  academic_schedule: { ...p.academic_schedule, [day]: { ...p.academic_schedule[day], end_time: e.target.value } },
                                }))}
                                className="flex-1 h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                              />
                            </div>
                          ))}
                          <p className="text-xs text-muted-foreground/70">Unselected days have no classes.</p>
                        </div>
                      )}
                      {/* Existing work assignments — shown directly under the academic
                          schedule so a class window that conflicts with a shift is visible. */}
                      {academicScheduling && <StudentWorkSchedule character={char} />}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editFields.scholarship_enabled}
                          onChange={e => setEditFields(p => ({ ...p, scholarship_enabled: e.target.checked }))}
                          className="rounded"
                        />
                        <span className="text-xs text-foreground">Scholarship (free tuition)</span>
                      </label>
                      {/* Campus residency edit — three modes */}
                      {residencyMode === 'user_choice' && (
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground uppercase tracking-wider block">Campus Residency</label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setEditFields(p => ({ ...p, lives_on_campus: true }))}
                              className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                                editFields.lives_on_campus
                                  ? 'bg-blue-500/10 border-blue-500/50 text-blue-400'
                                  : 'bg-card border-border text-muted-foreground hover:border-blue-500/30'
                              }`}
                            >
                              Residential
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditFields(p => ({ ...p, lives_on_campus: false }))}
                              className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                                !editFields.lives_on_campus
                                  ? 'bg-secondary border-border text-foreground'
                                  : 'bg-card border-border text-muted-foreground hover:border-border'
                              }`}
                            >
                              Non-residential
                            </button>
                          </div>
                          {editFields.lives_on_campus && (
                            <p className="text-xs text-blue-400/80">Character's home will be set to this campus.</p>
                          )}
                        </div>
                      )}
                      {residencyMode === 'always_residential' && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/5 border border-blue-500/30">
                          <Home className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                          <p className="text-xs text-blue-400">Boarding school — Residential only.</p>
                        </div>
                      )}
                      {residencyMode === 'non_residential' && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30 border border-border">
                          <Home className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <p className="text-xs text-muted-foreground">Non-residential school — students always live at their own home.</p>
                        </div>
                      )}
                      {saveError && (
                        <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-2 py-1.5">{saveError}</p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setSaveError('');
                            saveEdit(student).catch(err => setSaveError(err?.message || 'Could not save this student'));
                          }}
                          className="flex-1 h-7 text-xs rounded-lg gap-1"
                        >
                          <Check className="w-3 h-3" /> Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={cancelEdit} className="h-7 px-2 rounded-lg">
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Action buttons (hidden while editing) */}
                  {!isEditing && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUnenroll(student.character_id, 'graduated')}
                        className="flex-1 h-7 text-xs rounded-lg"
                      >
                        Graduate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUnenroll(student.character_id, 'dropped')}
                        className="flex-1 h-7 text-xs rounded-lg text-destructive hover:text-destructive gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Dropout
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
        ) : (
          <p className="text-xs text-muted-foreground italic text-center py-4">No enrolled students</p>
        )}
      </div>
    </div>
  );
}