import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, GraduationCap, DollarSign, Award, Trash2, Home, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import CharacterAvatar from '@/components/chat/CharacterAvatar';

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
// Grammar school and high school are NEVER residential. No campus residency UI is shown.
// Only college/university/trade_school may ever support campus housing.
const NON_RESIDENTIAL_SCHOOL_TYPES = ['high_school', 'private_school', 'language_school', 'music_school', 'online_school'];

function schoolSupportsResidency(location) {
  const t = location?.school_type;
  if (!t) return false; // unknown type: no residency option unless explicitly a college/university
  if (NON_RESIDENTIAL_SCHOOL_TYPES.includes(t)) return false;
  return ['college', 'university', 'trade_school'].includes(t);
}

export default function SchoolEnrollmentSection({ location, onUpdate }) {
  const queryClient = useQueryClient();
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [selectedCharIds, setSelectedCharIds] = useState(new Set());
  const [scholarshipEnabled, setScholarshipEnabled] = useState(false);
  const [livesOnCampus, setLivesOnCampus] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [programName, setProgramName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [enrollmentType, setEnrollmentType] = useState('full_school');
  const [enrollError, setEnrollError] = useState('');

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
    setEnrolling(true);
    setEnrollError('');
    try {
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
          lives_on_campus: livesOnCampus,
        })
      ));
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        const msg = failures[0].reason?.response?.data?.error || failures[0].reason?.message || 'Enrollment failed';
        setEnrollError(msg);
      }

      // If lives on campus, also update location residents and character home
      let newResidents = [...(location.residents || [])];
      if (livesOnCampus && failures.length === 0) {
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
            lives_on_campus: livesOnCampus,
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
              ...(livesOnCampus ? { current_home_location_id: location.id } : {}),
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

  const startEdit = (student) => {
    setEditingStudentId(student.character_id);
    setEditFields({
      course_name: student.course_name || '',
      enroll_date: student.enroll_date ? new Date(student.enroll_date).toISOString().slice(0, 10) : '',
      start_date: student.start_date ? new Date(student.start_date).toISOString().slice(0, 10) : '',
      end_date: student.end_date ? new Date(student.end_date).toISOString().slice(0, 10) : '',
      scholarship_enabled: student.scholarship_enabled || false,
      lives_on_campus: student.lives_on_campus || false,
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

      // Helper: patch matching enrollment entry in an array
      const patchArray = (arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        // Match by location_id or by course_name
        const idx = arr.findIndex(e =>
          e.location_id === location.id ||
          e.in_person_location_id === location.id ||
          (e.course_name && e.course_name === (student.course_name || location.name))
        );
        if (idx === -1) return null;
        const patched = [...arr];
        patched[idx] = { ...patched[idx], ...syncFields };
        return patched;
      };

      const patchedEnrollments = patchArray(char.education_enrollments);
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

  const supportsResidency = schoolSupportsResidency(location);
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

              {/* Lives on Campus — only shown for college/university (residential school types) */}
              {supportsResidency ? (
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
                      🏠 Lives on campus
                    </button>
                    <button
                      onClick={() => setLivesOnCampus(false)}
                      className={`flex-1 py-2 rounded-lg text-xs border transition-colors ${
                        !livesOnCampus ? 'bg-secondary border-border text-foreground' : 'bg-card border-border text-muted-foreground hover:border-border'
                      }`}
                    >
                      🏘 Does not live on campus
                    </button>
                  </div>
                  {livesOnCampus && (
                    <p className="text-xs text-blue-400/80">
                      Character will be added as a campus resident and their home location set to this school.
                    </p>
                  )}
                </div>
              ) : (
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
              const isOnCampus = student.lives_on_campus === true;
              const isEditing = editingStudentId === student.character_id;
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
                        {/* Campus residency — shown for all school types.
                            For non-residential types: always "Does not live on campus" (not editable).
                            For residential types: shows actual saved value. */}
                        <span className={`text-xs flex items-center gap-1 px-1.5 py-0.5 rounded-md border ${
                          supportsResidency && isOnCampus
                            ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
                            : 'text-muted-foreground bg-secondary/50 border-border'
                        }`}>
                          <Home className="w-3 h-3" />
                          {supportsResidency
                            ? (isOnCampus ? 'Lives on campus' : 'Does not live on campus')
                            : 'Non-residential school'
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
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editFields.scholarship_enabled}
                          onChange={e => setEditFields(p => ({ ...p, scholarship_enabled: e.target.checked }))}
                          className="rounded"
                        />
                        <span className="text-xs text-foreground">Scholarship (free tuition)</span>
                      </label>
                      {/* Campus residency — only editable for college/university (residential school types) */}
                      {supportsResidency ? (
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
                              🏠 Lives on campus
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
                              🏘 Does not live on campus
                            </button>
                          </div>
                          {editFields.lives_on_campus && (
                            <p className="text-xs text-blue-400/80">Character's home will be set to this campus.</p>
                          )}
                          {!editFields.lives_on_campus && (
                            <p className="text-xs text-muted-foreground">Character sleeps at their own home, not on campus.</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30 border border-border">
                          <Home className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <p className="text-xs text-muted-foreground">Non-residential school — students always live at their own home.</p>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(student)} className="flex-1 h-7 text-xs rounded-lg gap-1">
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