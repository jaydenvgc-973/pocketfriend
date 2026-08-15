import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Lock, Unlock, Eye, TrendingUp, Award, AlertTriangle, Shield, Newspaper, Star, Loader2, Sparkles } from 'lucide-react';

const RECOGNITION_LABELS = {
  unknown: 'Unknown', familiar_face: 'Familiar Face', locally_known: 'Locally Known',
  rising: 'Rising', established: 'Established', major_celebrity: 'Major Celebrity',
  a_list: 'A-List', iconic: 'Iconic',
};
const SCOPE_LABELS = {
  none: '—', neighborhood: 'Neighborhood', community: 'Community', local: 'Local',
  regional: 'Regional', professional: 'Professional Circle', industry: 'Industry',
  cultural: 'Cultural Circle', national: 'National', international: 'International',
  specialized: 'Specialized Audience',
};
const CATEGORY_LABELS = {
  community_participation: 'Community Participation', campaign: 'Campaign', performance: 'Performance',
  public_appearance: 'Public Appearance', public_activism: 'Public Activism', fashion_show: 'Fashion Show',
  photo_campaign: 'Photo Campaign', charity_event: 'Charity Event', award: 'Award',
  publication: 'Publication', interview: 'Interview', public_incident: 'Public Incident', other: 'Other',
};
const TIER_LABELS = { headliner: 'Headliner', feature: 'Feature', secondary: 'Secondary', minor_mention: 'Minor Mention' };

function MetricBar({ label, value, color = 'primary', icon: Icon }) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs font-medium text-foreground flex items-center gap-1">
          {Icon && <Icon className="w-3 h-3" />}{label}
        </span>
        <span className="text-xs text-muted-foreground">{Math.round(value)}%</span>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full bg-${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function LockToggle({ locked, onToggle, label }) {
  return (
    <button
      onClick={onToggle}
      className={`p-1 rounded-lg transition-colors ${locked ? 'text-amber-400 hover:bg-amber-500/10' : 'text-muted-foreground hover:bg-secondary'}`}
      title={locked ? `${label} locked — click to unlock` : `${label} unlocked — click to lock`}
    >
      {locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
    </button>
  );
}

export default function PublicRelationsSection({ character }) {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['publicProfile', character?.id],
    queryFn: async () => {
      if (!character?.id) return null;
      const results = await base44.entities.PublicProfile.filter({ character_id: character.id }, null, 1);
      return results[0] || null;
    },
    enabled: !!character?.id,
    staleTime: 30000,
  });

  const lockMutation = useMutation({
    mutationFn: async ({ lockKey, newValue }) => {
      const currentLocks = profile?.locks || {};
      const newLocks = { ...currentLocks, [lockKey]: newValue };
      // Also set recognition_locked boolean when recognition lock changes
      const update = { locks: newLocks };
      if (lockKey === 'recognition') {
        update.recognition_locked = newValue;
      }
      return base44.entities.PublicProfile.update(profile.id, update);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['publicProfile', character?.id] });
    },
  });

  const handleToggleLock = (lockKey) => {
    if (!profile) return;
    const currentLocks = profile.locks || {};
    lockMutation.mutate({ lockKey, newValue: !currentLocks[lockKey] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No profile yet — show create button
  if (!profile) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground italic">
          No public profile exists yet. A public profile is created when this character's first public-facing event is designated for public impact, or you can create one now for an established public figure.
        </p>
        <button
          onClick={async () => {
            const res = await base44.functions.invoke('initializePublicProfile', {
              character_id: character.id,
              owner_email: character.owner_email,
            });
            if (res?.data?.public_profile) {
              queryClient.invalidateQueries({ queryKey: ['publicProfile', character.id] });
            }
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Create Public Profile
        </button>
      </div>
    );
  }

  const recognitionLabel = RECOGNITION_LABELS[profile.recognition_level] || 'Unknown';
  const scopeLabel = SCOPE_LABELS[profile.recognition_scope] || '—';
  const locks = profile.locks || {};

  return (
    <div className="space-y-4">
      {/* Concise recognition status — always visible */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">{recognitionLabel}</p>
            <p className="text-[10px] text-muted-foreground">{scopeLabel} scope</p>
          </div>
        </div>
        {profile.recognition_locked && (
          <span className="flex items-center gap-1 text-[10px] text-amber-400">
            <Lock className="w-3 h-3" /> Locked
          </span>
        )}
      </div>

      {/* Expandable detailed view */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-xs text-primary hover:text-primary/80 transition-colors"
      >
        {isExpanded ? '− Hide details' : '+ Show full public relations'}
      </button>

      {isExpanded && (
        <div className="space-y-4 pt-2 border-t border-border">
          {/* Recognition with lock */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recognition</p>
              <p className="text-sm font-medium text-foreground">{recognitionLabel} · {scopeLabel}</p>
            </div>
            <LockToggle locked={locks.recognition} onToggle={() => handleToggleLock('recognition')} label="Recognition" />
          </div>

          {/* Current Attention */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground flex items-center gap-1">
                <Eye className="w-3 h-3" /> Current Attention
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{Math.round(profile.current_attention || 0)}%</span>
                <LockToggle locked={locks.current_attention} onToggle={() => handleToggleLock('current_attention')} label="Current Attention" />
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${profile.current_attention || 0}%` }} />
            </div>
            {profile.attention_scope && profile.attention_scope !== 'none' && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{SCOPE_LABELS[profile.attention_scope]}</p>
            )}
          </div>

          {/* Respect */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground flex items-center gap-1">
                <Award className="w-3 h-3" /> Respect
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{Math.round(profile.respect_level || 0)}%</span>
                <LockToggle locked={locks.respect} onToggle={() => handleToggleLock('respect')} label="Respect" />
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${profile.respect_level || 0}%` }} />
            </div>
          </div>

          {/* Notoriety */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> Notoriety
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{Math.round(profile.notoriety_level || 0)}%</span>
                <LockToggle locked={locks.notoriety} onToggle={() => handleToggleLock('notoriety')} label="Notoriety" />
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 transition-all" style={{ width: `${profile.notoriety_level || 0}%` }} />
            </div>
          </div>

          {/* Infamy */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Infamy
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{Math.round(profile.infamy_level || 0)}%</span>
                <LockToggle locked={locks.infamy} onToggle={() => handleToggleLock('infamy')} label="Infamy" />
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-rose-500 transition-all" style={{ width: `${profile.infamy_level || 0}%` }} />
            </div>
          </div>

          {/* Known For */}
          {profile.known_for && profile.known_for.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Known For</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.known_for.map((k, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{k}</span>
                ))}
              </div>
            </div>
          )}

          {/* Public Persona */}
          {profile.public_persona && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Public Persona</p>
              <p className="text-xs text-foreground/80 leading-relaxed">{profile.public_persona}</p>
            </div>
          )}

          {/* World Perception */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
              <Shield className="w-3 h-3" /> What the World Thinks
            </p>
            {profile.world_perception_insufficient !== false && !profile.world_perception ? (
              <p className="text-xs text-muted-foreground/70 italic">
                Not enough public information is available to establish a meaningful public reputation.
              </p>
            ) : (
              <p className="text-xs text-foreground/80 leading-relaxed">{profile.world_perception}</p>
            )}
          </div>

          {/* Public Record */}
          {profile.public_record && profile.public_record.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                <Newspaper className="w-3 h-3" /> Public Record
              </p>
              <div className="space-y-2">
                {profile.public_record.slice().reverse().map((entry, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-secondary/40 border border-border">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs font-medium text-foreground">{entry.event_title}</p>
                      <span className="text-[9px] text-muted-foreground">{entry.event_date}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{CATEGORY_LABELS[entry.public_category] || entry.public_category}</span>
                      <span>·</span>
                      <span>{SCOPE_LABELS[entry.exposure_scope] || entry.exposure_scope}</span>
                      <span>·</span>
                      <span className="capitalize">{TIER_LABELS[entry.impact_tier] || entry.impact_tier}</span>
                    </div>
                    {entry.impact_summary && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed">{entry.impact_summary}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}