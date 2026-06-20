import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const NEED_CONFIG = [
  { key: 'hunger', label: 'Hunger' },
  { key: 'energy', label: 'Energy' },
  { key: 'hygiene', label: 'Hygiene' },
  { key: 'comfort', label: 'Comfort' },
  { key: 'social', label: 'Social' },
  { key: 'mental', label: 'Mental' },
  { key: 'health', label: 'Health' },
  { key: 'financial', label: 'Financial' },
];

export default function HybridNeedsLockPanel({ character }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (newLocks) => {
      const payload = { needs_locks: { ...character.needs_locks, ...newLocks } };
      return base44.entities.Character.update(character.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
    },
  });

  const handleToggle = (needKey) => {
    const currentLocks = character.needs_locks || {};
    mutation.mutate({ [needKey]: !currentLocks[needKey] });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">Hybrid Needs Lock</h3>
        <p className="text-xs text-muted-foreground">
          For hybrid characters like Vick Servicio, lock needs to prevent autonomous decay, recovery, and related actions.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {NEED_CONFIG.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between space-x-2 rounded-lg border p-3">
            <Label htmlFor={`lock-${key}`} className="text-sm font-medium">
              {label}
            </Label>
            <Switch
              id={`lock-${key}`}
              checked={!!(character.needs_locks?.[key])}
              onCheckedChange={() => handleToggle(key)}
              disabled={mutation.isPending}
            />
          </div>
        ))}
      </div>
    </div>
  );
}