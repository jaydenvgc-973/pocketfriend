import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Globe, Loader2, Sparkles, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import BottomNav from '@/components/BottomNav';
import { useSettingsCharacters } from '@/hooks/useSettingsCharacters';
import SettingsCharacterList from '@/components/settings/SettingsCharacterList';

const RECOGNITION_LABELS = {
  unknown: 'Unknown', familiar_face: 'Familiar Face', locally_known: 'Locally Known',
  rising: 'Rising', established: 'Established', major_celebrity: 'Major Celebrity',
  a_list: 'A-List', iconic: 'Iconic',
};
const SCOPE_LABELS = {
  none: '—', neighborhood: 'Neighborhood', community: 'Community', local: 'Local',
  regional: 'Regional', professional: 'Professional', industry: 'Industry',
  cultural: 'Cultural', national: 'National', international: 'International',
  specialized: 'Specialized',
};

const LOCKABLE_METRICS = [
  { key: 'recognition', label: 'Recognition / Fame', desc: 'How widely this character is known. Lock to preserve established celebrity status.' },
  { key: 'current_attention', label: 'Current Attention', desc: 'How intensely the public is currently paying attention' },
  { key: 'respect', label: 'Respect', desc: 'Earned public and community esteem' },
  { key: 'notoriety', label: 'Notoriety', desc: 'Being notably discussed due to remarkable or controversial circumstances' },
  { key: 'infamy', label: 'Infamy', desc: 'Broad recognition associated with negative public history' },
  { key: 'public_image', label: 'Public Image', desc: 'How the public currently perceives this character' },
];

export default function EditCharacterPublicRelations() {
  const queryClient = useQueryClient();
  const [selectedCharId, setSelectedCharId] = useState(null);

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { sections, allCharacters: characters, isLoading } = useSettingsCharacters(user, 'traits');

  const selectedChar = characters.find(c => c.id === selectedCharId);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['publicProfile', selectedCharId],
    queryFn: async () => {
      if (!selectedCharId) return null;
      const results = await base44.entities.PublicProfile.filter({ character_id: selectedCharId }, null, 1);
      return results[0] || null;
    },
    enabled: !!selectedCharId,
    staleTime: 30000,
  });

  const handleToggleLock = async (lockKey, newValue) => {
    if (!profile) return;
    const currentLocks = profile.locks || {};
    const newLocks = { ...currentLocks, [lockKey]: newValue };
    const update = { locks: newLocks };
    if (lockKey === 'recognition') {
      update.recognition_locked = newValue;
    }
    await base44.entities.PublicProfile.update(profile.id, update);
    queryClient.invalidateQueries({ queryKey: ['publicProfile', selectedCharId] });
  };

  const handleCreateProfile = async () => {
    if (!selectedChar) return;
    const res = await base44.functions.invoke('initializePublicProfile', {
      character_id: selectedChar.id,
      owner_email: selectedChar.owner_email,
    });
    if (res?.data?.public_profile) {
      queryClient.invalidateQueries({ queryKey: ['publicProfile', selectedCharId] });
    }
  };

  const getMetricValue = (key) => {
    if (!profile) return '—';
    if (key === 'recognition') {
      return `${RECOGNITION_LABELS[profile.recognition_level] || 'Unknown'} · ${SCOPE_LABELS[profile.recognition_scope] || '—'}`;
    }
    if (key === 'current_attention') return `${Math.round(profile.current_attention || 0)}%`;
    if (key === 'respect') return `${Math.round(profile.respect_level || 0)}%`;
    if (key === 'notoriety') return `${Math.round(profile.notoriety_level || 0)}%`;
    if (key === 'infamy') return `${Math.round(profile.infamy_level || 0)}%`;
    if (key === 'public_image') return profile.public_image || 'Not established';
    return '—';
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-sm font-semibold">Character Public Relations</h2>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
        {/* Character selector */}
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Select a character</p>
          {isLoading ? (
            <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
          ) : (
            <SettingsCharacterList
              sections={sections}
              onSelect={(char) => setSelectedCharId(char.id)}
              renderSubtitle={() => 'Public Relations controls'}
              emptyMessage="No characters yet."
            />
          )}
        </div>

        {/* PR controls */}
        {selectedChar && (
          <div className="border-t border-border pt-4 space-y-4">
            {profileLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : !profile ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground italic">
                  No public profile exists yet. Create one to start tracking this character's public relations.
                </p>
                <Button onClick={handleCreateProfile} className="w-full rounded-xl h-11 gap-2">
                  <Sparkles className="w-4 h-4" /> Create Public Profile
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tracking Controls</p>
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    Toggle each metric between <span className="text-foreground font-medium">Dynamic</span> (the world can update it through legitimate events) and <span className="text-amber-400 font-medium">Locked</span> (preserves the current value). Locking one metric does not freeze the others.
                  </p>
                </div>

                {LOCKABLE_METRICS.map(metric => {
                  const isLocked = profile.locks?.[metric.key] || false;
                  return (
                    <div key={metric.key} className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{metric.label}</p>
                          {isLocked && <Lock className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{getMetricValue(metric.key)}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">{metric.desc}</p>
                      </div>
                      <div className="flex flex-col items-center gap-1 flex-shrink-0 ml-3">
                        <Switch
                          checked={isLocked}
                          onCheckedChange={(v) => handleToggleLock(metric.key, v)}
                        />
                        <span className={`text-[10px] font-medium ${isLocked ? 'text-amber-400' : 'text-muted-foreground'}`}>
                          {isLocked ? 'Locked' : 'Dynamic'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}