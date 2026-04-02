import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Award } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

export default function EnrollmentOption({ character, currentLocation, onClose }) {
  const queryClient = useQueryClient();
  const [scholarshipEnabled, setScholarshipEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: school } = useQuery({
    queryKey: ['school', currentLocation],
    queryFn: async () => {
      const locs = await base44.entities.LocationReference.filter({
        id: currentLocation
      });
      return locs[0];
    },
    enabled: !!currentLocation,
  });

  // Check if already enrolled in this school
  const alreadyEnrolled = (character.education_enrollments || []).some(
    e => e.location_id === currentLocation && e.status === 'active'
  );

  if (!school || !['education', 'school'].includes(school.category) || alreadyEnrolled) {
    return null;
  }

  const handleEnroll = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('enrollCharacterInSchool', {
        character_id: character.id,
        character_name: character.name,
        location_id: currentLocation,
        scholarship_enabled: scholarshipEnabled
      });

      if (res?.data?.success) {
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        onClose?.();
      }
    } catch (err) {
      console.error('Enrollment error:', err);
    } finally {
      setLoading(false);
    }
  };

  const tuitionAmount = school.tuition_cost || 0;
  const frequency = school.tuition_frequency || 'annual';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="bg-card border border-primary/30 rounded-xl p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <GraduationCap className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Enroll in {school.name}?</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        Would you like to enroll here? You can study, attend classes, and meet other students.
      </p>

      {tuitionAmount > 0 && (
        <div className="bg-secondary/30 rounded-lg p-2">
          <p className="text-xs text-muted-foreground">
            Tuition: <span className="font-semibold text-foreground">${tuitionAmount}/{frequency}</span>
          </p>
        </div>
      )}

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={scholarshipEnabled}
          onChange={(e) => setScholarshipEnabled(e.target.checked)}
          className="rounded w-4 h-4"
        />
        <span className="text-sm text-foreground flex items-center gap-1">
          <Award className="w-3.5 h-3.5 text-yellow-400" />
          On scholarship (free tuition)
        </span>
      </label>

      <div className="flex gap-2">
        <Button
          onClick={handleEnroll}
          disabled={loading}
          className="flex-1 h-9 rounded-lg text-sm"
        >
          {loading ? 'Enrolling...' : 'Enroll Now'}
        </Button>
        <Button
          variant="outline"
          onClick={onClose}
          className="flex-1 h-9 rounded-lg text-sm"
        >
          Not Now
        </Button>
      </div>
    </motion.div>
  );
}