import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, LogOut, Award, DollarSign, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

export default function StudentStatusCard({ character }) {
  const queryClient = useQueryClient();
  const [loadingId, setLoadingId] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: schools = [] } = useQuery({
    queryKey: ['schools', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.LocationReference.filter({
          created_by: currentUser.email,
          category: 'school'
        })
      : [],
    enabled: !!currentUser?.email,
  });

  const activeEnrollments = (character.education_enrollments || [])
    .filter(e => e.status === 'active')
    .map(e => {
      const school = schools.find(s => s.id === e.location_id);
      return { ...e, schoolData: school };
    });

  if (activeEnrollments.length === 0) return null;

  const handleUnenroll = async (locationId) => {
    if (!window.confirm('Drop out of this school?')) return;
    setLoadingId(locationId);

    try {
      const res = await base44.functions.invoke('unenrollCharacterFromSchool', {
        character_id: character.id,
        location_id: locationId,
        reason: 'dropped'
      });

      if (res?.data?.success) {
        queryClient.invalidateQueries({ queryKey: ['characters'] });
      }
    } catch (err) {
      console.error('Unenroll error:', err);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <GraduationCap className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Student Status</h3>
      </div>

      <div className="space-y-2">
        {activeEnrollments.map((enrollment, idx) => (
          <div key={idx} className="bg-secondary/40 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {enrollment.schoolData?.name || enrollment.location_name}
                </p>
                {enrollment.scholarship_enabled && (
                  <div className="flex items-center gap-1 mt-1">
                    <Award className="w-3 h-3 text-yellow-400" />
                    <span className="text-xs text-yellow-400">On Scholarship</span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {!enrollment.scholarship_enabled && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <DollarSign className="w-3 h-3" />
                  <span>${(enrollment.tuition_amount || 0).toFixed(0)}/mo</span>
                </div>
              )}
              <div className="flex items-center gap-1 text-muted-foreground">
                <Calendar className="w-3 h-3" />
                <span>{new Date(enrollment.enroll_date).toLocaleDateString()}</span>
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => handleUnenroll(enrollment.location_id)}
              disabled={loadingId === enrollment.location_id}
              className="w-full h-8 text-xs rounded-lg gap-1"
            >
              <LogOut className="w-3 h-3" />
              {loadingId === enrollment.location_id ? 'Dropping...' : 'Drop Out'}
            </Button>
          </div>
        ))}
      </div>
    </motion.div>
  );
}