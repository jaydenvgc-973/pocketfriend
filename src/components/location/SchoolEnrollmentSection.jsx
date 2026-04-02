import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, GraduationCap, DollarSign, Award, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

export default function SchoolEnrollmentSection({ location, onUpdate }) {
  const queryClient = useQueryClient();
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [scholarshipEnabled, setScholarshipEnabled] = useState(false);
  const [loadingCharId, setLoadingCharId] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email, status: 'active' }, '-created_date')
      : [],
    enabled: !!currentUser?.email,
  });

  const enrolledCharIds = (location.enrolled_students || [])
    .filter(s => s.status === 'active')
    .map(s => s.character_id);

  const availableCharacters = characters.filter(c => !enrolledCharIds.includes(c.id));

  const handleEnroll = async () => {
    if (!selectedCharId) return;
    setLoadingCharId(selectedCharId);

    try {
      const res = await base44.functions.invoke('enrollCharacterInSchool', {
        character_id: selectedCharId,
        character_name: characters.find(c => c.id === selectedCharId)?.name || 'Unknown',
        location_id: location.id,
        scholarship_enabled: scholarshipEnabled
      });

      if (res?.data?.success) {
        queryClient.invalidateQueries({ queryKey: ['locations'] });
        setShowAddStudent(false);
        setSelectedCharId(null);
        setScholarshipEnabled(false);
      }
    } catch (err) {
      console.error('Enrollment error:', err);
    } finally {
      setLoadingCharId(null);
    }
  };

  const handleUnenroll = async (charId, reason = 'dropped') => {
    if (!window.confirm(`${reason === 'graduated' ? 'Graduate' : 'Remove'} this student?`)) return;

    try {
      const res = await base44.functions.invoke('unenrollCharacterFromSchool', {
        character_id: charId,
        location_id: location.id,
        reason
      });

      if (res?.data?.success) {
        queryClient.invalidateQueries({ queryKey: ['locations'] });
      }
    } catch (err) {
      console.error('Unenroll error:', err);
    }
  };

  const tuitionDisplay = location.tuition_cost || 'Not set';
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
            className="bg-secondary/40 rounded-lg p-3 space-y-3"
          >
            <div>
              <label className="text-xs text-muted-foreground block mb-2">Select Character</label>
              <select
                value={selectedCharId || ''}
                onChange={(e) => setSelectedCharId(e.target.value)}
                className="w-full h-9 rounded-lg bg-card border border-border px-3 text-sm"
              >
                <option value="">Choose a character...</option>
                {availableCharacters.map(char => (
                  <option key={char.id} value={char.id}>
                    {char.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scholarshipEnabled}
                onChange={(e) => setScholarshipEnabled(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-foreground">Scholarship (free tuition)</span>
            </label>

            <div className="flex gap-2">
              <Button
                onClick={handleEnroll}
                disabled={!selectedCharId || loadingCharId === selectedCharId}
                className="flex-1 h-9 rounded-lg text-sm"
              >
                {loadingCharId === selectedCharId ? 'Enrolling...' : 'Enroll'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAddStudent(false)}
                className="flex-1 h-9 rounded-lg text-sm"
              >
                Cancel
              </Button>
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
          <span className="font-semibold text-foreground">
            ${location.tuition_cost || 0}
          </span>
        </div>
      </div>

      {/* Student List */}
      <div className="space-y-2">
        {(location.enrolled_students || []).filter(s => s.status === 'active').length > 0 ? (
          (location.enrolled_students || [])
            .filter(s => s.status === 'active')
            .map((student, idx) => (
              <div key={idx} className="bg-card border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{student.character_name}</p>
                    {student.scholarship_enabled && (
                      <div className="flex items-center gap-1 mt-1">
                        <Award className="w-3 h-3 text-yellow-400" />
                        <span className="text-xs text-yellow-400">Scholarship</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Monthly</p>
                      <p className="text-sm font-semibold text-foreground">
                        ${student.scholarship_enabled ? 0 : (student.tuition_amount || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

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
                    className="h-7 px-2 rounded-lg text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))
        ) : (
          <p className="text-xs text-muted-foreground italic text-center py-4">No enrolled students</p>
        )}
      </div>
    </div>
  );
}