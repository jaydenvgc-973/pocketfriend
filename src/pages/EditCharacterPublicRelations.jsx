import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Sparkles, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
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

// ── Recognition tier ↔ percentage mapping (single source of truth) ──────────
// recognition_level is an enum in the schema; the slider maps to/from it.
const RECOGNITION_TIERS = [
  { level: 'unknown',         label: 'Unknown',          min: 0,  max: 9,   mid: 5  },
  { level: 'familiar_face',   label: 'Familiar Face',     min: 10, max: 24,  mid: 17 },
  { level: 'locally_known',   label: 'Locally Known',     min: 25, max: 39,  mid: 32 },
  { level: 'rising',          label: 'Rising',            min: 40, max: 54,  mid: 47 },
  { level: 'established',     label: 'Established',        min: 55, max: 69,  mid: 62 },
  { level: 'major_celebrity', label: 'Major Celebrity',   min: 70, max: 84,  mid: 77 },
  { level: 'a_list',          label: 'A-List',             min: 85, max: 94,  mid: 90 },
  { level: 'iconic',          label: 'Iconic',             min: 95, max: 100, mid: 98 },
];

function recognitionLevelToPercent(level) {
  const tier = RECOGNITION_TIERS.find(t => t.level === level);
  return tier ? tier.mid : 5;
}

function percentToRecognitionLevel(pct) {
  const tier = RECOGNITION_TIERS.find(t => pct >= t.min && pct <= t.max);
  return tier ? tier.level : 'unknown';
}

function percentToRecognitionLabel(pct) {
  const tier = RECOGNITION_TIERS.find(t => pct >= t.min && pct <= t.max);
  return tier ? tier.label : 'Unknown';
}

// ── Numeric metrics (direct 0-100 values on PublicProfile) ─────────────────
const NUMERIC_METRICS = [
  { key: 'current_attention', label: 'Current Attention', field: 'current_attention', lockKey: 'current_attention', desc: 'How intensely the public is currently paying attention' },
  { key: 'respect',           label: 'Respect',            field: 'respect_level',     lockKey: 'respect',           desc: 'Earned public and community esteem' },
  { key: 'notoriety',         label: 'Notoriety',          field: 'notoriety_level',   lockKey: 'notoriety',         desc: 'Being notably discussed due to remarkable or controversial circumstances' },
  { key: 'infamy',            label: 'Infamy',             field: 'infamy_level',      lockKey: 'infamy',            desc: 'Broad recognition associated with negative public history' },
];

export default function EditCharacterPublicRelations() {
  const queryClient = useQueryClient();
  const [selectedCharId, setSelectedCharId] = useState(null);
  // Local drag state for smooth slider UX; persisted on commit (release)
  const [sliderValues, setSliderValues] = useState({});
  const [recognitionPct, setRecognitionPct] = useState(5);

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

  // Sync local slider state whenever the authoritative profile changes
  useEffect(() => {
    if (!profile) {
      setSliderValues({});
      setRecognitionPct(5);
      return;
    }
    setSliderValues({
      current_attention: profile.current_attention || 0,
      respect_level: profile.respect_level || 0,
      notoriety_level: profile.notoriety_level || 0,
      infamy_level: profile.infamy_level || 0,
    });
    setRecognitionPct(recognitionLevelToPercent(profile.recognition_level));
  }, [profile?.id, profile?.current_attention, profile?.respect_level,
      profile?.notoriety_level, profile?.infamy_level, profile?.recognition_level]);

  // ── Persistence (fires on slider release, not every drag tick) ────────────
  const persistNumericMetric = async (field, value) => {
    if (!profile) return;
    await base44.entities.PublicProfile.update(profile.id, { [field]: Math.round(value) });
    queryClient.invalidateQueries({ queryKey: ['publicProfile', selectedCharId] });
  };

  const persistRecognition = async (pct) => {
    if (!profile) return;
    const level = percentToRecognitionLevel(pct);
    await base44.entities.PublicProfile.update(profile.id, { recognition_level: level });
    queryClient.invalidateQueries({ queryKey: ['publicProfile', selectedCharId] });
  };

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
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Public Standing</p>
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    Drag each bar to set the current value. Toggle <span className="text-amber-400 font-medium">Locked</span> to freeze a metric against autonomous PR updates. Locking does not change the value; changing the value does not require locking.
                  </p>
                </div>

                {/* ── Recognition / Fame (enum-backed slider) ─────────────────── */}
                {(() => {
                  const isLocked = profile.locks?.recognition || false;
                  const tierLabel = percentToRecognitionLabel(recognitionPct);
                  const scopeLabel = SCOPE_LABELS[profile.recognition_scope] || '—';
                  return (
                    <div className="p-3 rounded-xl bg-card border border-border space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">Recognition / Fame</p>
                            {isLocked && <Lock className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                          </div>
                          <p className="text-xs text-primary font-medium mt-0.5">{tierLabel} · {scopeLabel}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">How widely this character is known</p>
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-shrink-0 ml-3">
                          <Switch checked={isLocked} onCheckedChange={(v) => handleToggleLock('recognition', v)} />
                          <span className={`text-[10px] font-medium ${isLocked ? 'text-amber-400' : 'text-muted-foreground'}`}>
                            {isLocked ? 'Locked' : 'Dynamic'}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Slider
                          value={[recognitionPct]}
                          onValueChange={(vals) => setRecognitionPct(vals[0])}
                          onValueCommit={(vals) => persistRecognition(vals[0])}
                          max={100}
                          step={1}
                          className="py-2"
                        />
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-muted-foreground/50">{RECOGNITION_TIERS[0].label}</span>
                          <span className="text-sm font-semibold text-foreground">{Math.round(recognitionPct)}%</span>
                          <span className="text-[9px] text-muted-foreground/50">{RECOGNITION_TIERS[RECOGNITION_TIERS.length - 1].label}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Numeric metrics (direct 0-100 sliders) ────────────────── */}
                {NUMERIC_METRICS.map(metric => {
                  const isLocked = profile.locks?.[metric.lockKey] || false;
                  const val = sliderValues[metric.field] || 0;
                  return (
                    <div key={metric.key} className="p-3 rounded-xl bg-card border border-border space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{metric.label}</p>
                            {isLocked && <Lock className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                          </div>
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">{metric.desc}</p>
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-shrink-0 ml-3">
                          <Switch checked={isLocked} onCheckedChange={(v) => handleToggleLock(metric.lockKey, v)} />
                          <span className={`text-[10px] font-medium ${isLocked ? 'text-amber-400' : 'text-muted-foreground'}`}>
                            {isLocked ? 'Locked' : 'Dynamic'}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Slider
                          value={[val]}
                          onValueChange={(vals) => setSliderValues(prev => ({ ...prev, [metric.field]: vals[0] }))}
                          onValueCommit={(vals) => persistNumericMetric(metric.field, vals[0])}
                          max={100}
                          step={1}
                          className="py-2"
                        />
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-muted-foreground/50">0%</span>
                          <span className="text-sm font-semibold text-foreground">{Math.round(val)}%</span>
                          <span className="text-[9px] text-muted-foreground/50">100%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* ── Descriptive fields note ───────────────────────────────── */}
                <div className="p-3 rounded-xl bg-secondary/30 border border-border">
                  <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                    Descriptive fields — Public Image, Public Persona, Known For, World Perception, and Reputation Contexts — are managed from the Character Profile's Public Relations section, not this page.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}