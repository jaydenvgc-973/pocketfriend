import React, { useState, useCallback, useEffect } from "react";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Cake, BookOpen, Users, User, Ghost, Zap, Wrench, Briefcase, GraduationCap, MapPin, Camera, ZoomIn, Heart, Settings, Clock, X, BarChart3, Home as HomeIcon, Shirt, AlertCircle, MessageCircle, Activity } from "lucide-react";
import CollapsibleProfileSection from "@/components/character/CollapsibleProfileSection";
import { useNavigate } from "react-router-dom";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import FamilyEditor from "@/components/character/FamilyEditor";
import CharacterFeelingsCard from "@/components/character/CharacterFeelingsCard";
import CharacterFinancialSummary from "@/components/character/CharacterFinancialSummary";
import { registerForegroundTask, FOREGROUND_TASKS } from "@/lib/foregroundPriority";
import { EditableTextField, EditableSelectField, EditableEthnicityField, NonEditableField } from "@/components/character/ProfileFieldEditor";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { calculateBirthdateFromZodiac } from "@/lib/zodiacUtils";
import { getReciprocalRole, getRelationshipLabel } from "@/lib/relationshipUtils";
import ProfileTroubleshootingPanel from "@/components/character/ProfileTroubleshootingPanel";
import NPCPromotionModal from "@/components/character/NPCPromotionModal";
import NPCPhotoEditor from "@/components/character/NPCPhotoEditor";
import CharacterAliasEditor from "@/components/character/CharacterAliasEditor.jsx";
import AppearanceAgeField from "@/components/character/AppearanceAgeField.jsx";
import AppearanceLockEditor from "@/components/character/AppearanceLockEditor.jsx";
import CharacterEditSettingsPanel from "@/components/character/CharacterEditSettingsPanel.jsx";
import HomeLocationField from "@/components/character/HomeLocationField.jsx";
import CharacterExpenseManager from "@/components/finance/CharacterExpenseManager";
import MonthlyStatementPanel from "@/components/finance/MonthlyStatementPanel";
import CharacterNeedsPanel from "@/components/character/CharacterNeedsPanel";
import ManualNeedsEditor from "@/components/character/ManualNeedsEditor";
import CharacterWorkScheduleEditor from "@/components/character/CharacterWorkScheduleEditor";
import CharacterBusinessesPanel from "@/components/character/CharacterBusinessesPanel";
import LifeJournal from "@/components/character/LifeJournal";
import CharacterQuirksPanel from "@/components/character/CharacterQuirksPanel";
import CharacterClosetPanel from "@/components/character/CharacterClosetPanel";
import AddPeopleInTheirWorldPanel from "@/components/character/AddPeopleInTheirWorldPanel";
import RelationshipTensionCard from "@/components/character/RelationshipTensionCard";
import CharacterEducationSection from "@/components/character/CharacterEducationSection";
import CharacterReligionSection from "@/components/character/CharacterReligionSection";
import CharacterDashboard from "@/components/character/CharacterDashboard";

const ZODIAC_SIGNS = {
  "aries": { symbol: "♈", dates: "Mar 21 - Apr 19", emoji: "🐑" },
  "taurus": { symbol: "♉", dates: "Apr 20 - May 20", emoji: "🐂" },
  "gemini": { symbol: "♊", dates: "May 21 - Jun 20", emoji: "👯" },
  "cancer": { symbol: "♋", dates: "Jun 21 - Jul 22", emoji: "🦀" },
  "leo": { symbol: "♌", dates: "Jul 23 - Aug 22", emoji: "🦁" },
  "virgo": { symbol: "♍", dates: "Aug 23 - Sep 22", emoji: "👩‍🌾" },
  "libra": { symbol: "♎", dates: "Sep 23 - Oct 22", emoji: "⚖️" },
  "scorpio": { symbol: "♏", dates: "Oct 23 - Nov 21", emoji: "🦂" },
  "sagittarius": { symbol: "♐", dates: "Nov 22 - Dec 21", emoji: "🏹" },
  "capricorn": { symbol: "♑", dates: "Dec 22 - Jan 19", emoji: "🐐" },
  "aquarius": { symbol: "♒", dates: "Jan 20 - Feb 18", emoji: "🏺" },
  "pisces": { symbol: "♓", dates: "Feb 19 - Mar 20", emoji: "🐠" }
};

function calculateAge(dateString) {
  if (!dateString) return null;
  const today = new Date();
  const birth = new Date(dateString);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function getZodiacSign(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return "aries";
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return "taurus";
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return "gemini";
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return "cancer";
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return "leo";
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return "virgo";
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return "libra";
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return "scorpio";
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return "sagittarius";
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return "capricorn";
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return "aquarius";
  if ((month === 2 && day >= 19) || (month === 3 && day <= 20)) return "pisces";
  return null;
}

function NicknameForUserField({ character }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(character.nickname_for_user || "");
  React.useEffect(() => { setValue(character.nickname_for_user || ""); }, [character.nickname_for_user]);

  const mutation = useMutation({
    mutationFn: (nickname) => base44.entities.Character.update(character.id, { nickname_for_user: nickname }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["character", character.id] }),
  });

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">What They Call You</p>
      <p className="text-xs text-muted-foreground">Override the global name — give this character a unique name for you.</p>
      <input
        type="text"
        placeholder="Leave blank to use your world name"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => mutation.mutate(value)}
        className="w-full h-11 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
      />
    </div>
  );
}

const NPC_DRAFT_KEY = "create_character_draft";

export default function CharacterProfile() {
  const { characterId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSavingZodiac, setIsSavingZodiac] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [showEditSettings, setShowEditSettings] = useState(false);
  const [promotingNPC, setPromotingNPC] = useState(null);
  const [editingNPCPhoto, setEditingNPCPhoto] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [showOutfitSharer, setShowOutfitSharer] = useState(false);
  const [expandedMemory, setExpandedMemory] = useState(null);
  
  // Register a HIGH-priority foreground task for the duration of the profile load.
  // This signals background systems (archive, simulations, narratives) to yield.
  useEffect(() => {
    const release = registerForegroundTask(FOREGROUND_TASKS.PROFILE_LOAD, 'high');
    // Hold priority for 12 seconds — covers character + financial + feelings queries.
    const timer = setTimeout(release, 12000);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [characterId]);

  const { data: character, isLoading, refetch } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      // PRIMARY: user-scoped RLS query (works for own characters)
      const chars = await base44.entities.Character.filter({ id: characterId });
      if (chars[0]) {
        const { system_prompt, ...char } = chars[0];
        return char;
      }
      // FALLBACK: character may exist in the allCharacters cache (loaded by Home/Chat)
      // but not pass a fresh RLS filter if ownership fields are still backfilling.
      // Check the React Query cache directly before showing "not found".
      // This prevents the Home→Profile "Character not found" regression where the
      // character IS valid but its owner_email hasn't propagated to RLS yet.
      // Search all cache entries matching ["characters", *] since it's keyed by email.
      const allCacheEntries = queryClient.getQueriesData({ queryKey: ["characters"] });
      const cachedAll = allCacheEntries.find(([, data]) => Array.isArray(data))?.[1] ||
        queryClient.getQueryData(["characters"]) ||
        queryClient.getQueryData(["characters", ""]);
      if (Array.isArray(cachedAll)) {
        const fromCache = cachedAll.find(c => c.id === characterId);
        if (fromCache) {
          console.warn(`[CharacterProfile] RLS filter returned empty for ${characterId} — using allCharacters cache entry as fallback`);
          const { system_prompt, ...char } = fromCache;
          return char;
        }
      }
      return null;
    },
    enabled: !!characterId,
    staleTime: 0,
  });

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
    staleTime: 300000,
  });

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email || ""],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      await new Promise(r => setTimeout(r, 800));
      const chars = await base44.entities.Character.filter({ owner_email: currentUser.email });
      return chars.map(({ system_prompt, ...char }) => char);
    },
    enabled: !!currentUser?.email,
    staleTime: 120000,
  });

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings", currentUser?.email || ""],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      await new Promise(r => setTimeout(r, 1200));
      return base44.entities.UserSettings.filter({ owner_email: currentUser.email });
    },
    enabled: !!currentUser?.email,
    staleTime: 180000,
  });

  const { data: characterFinancial = null } = useQuery({
    queryKey: ['characterFinancial', characterId],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 500));
      const results = await base44.entities.CharacterFinancial.filter({ character_id: characterId });
      return results[0] || null;
    },
    enabled: !!characterId,
    staleTime: 120000,
  });

  const { data: workLocations = [] } = useQuery({
    queryKey: ['workLocations', characterId, character?.occupation_location_id, (character?.additional_occupation_locations || []).map(l => l.location_id).join(',')],
    queryFn: async () => {
      if (!character) return [];
      await new Promise(r => setTimeout(r, 2500));

      const seen = new Set();
      const combined = [];

      const addLoc = (loc) => {
        if (!loc || seen.has(loc.id)) return;
        seen.add(loc.id);
        combined.push(loc);
      };

      // SOURCE 1: Character-side occupation fields (fastest, most common)
      const locationIds = new Set();
      if (character.occupation_location_id) locationIds.add(character.occupation_location_id);
      (character.additional_occupation_locations || []).forEach(l => {
        if (l.location_id) locationIds.add(l.location_id);
      });

      for (const id of locationIds) {
        const result = await base44.entities.LocationReference.filter({ id }).then(r => r[0]).catch(() => null);
        if (result) addLoc(result);
      }

      // SOURCE 2: Location-side worker_character_ids array
      const byWorkerList = await base44.entities.LocationReference.filter({ worker_character_ids: [characterId] }).catch(() => []);
      byWorkerList.forEach(loc => addLoc(loc));

      // SOURCE 3: Location-side worker_job_titles / worker_shifts key presence
      // This is the canonical source for the arrow dropdown — we must read it too.
      // Many characters are assigned via the location editor without occupation_location_id
      // being synced back to the Character entity. Scanning by owner_email is the safe path.
      if (character.owner_email) {
        const ownerLocs = await base44.entities.LocationReference.filter({ owner_email: character.owner_email }).catch(() => []);
        ownerLocs.forEach(loc => {
          if (seen.has(loc.id)) return;
          // Check if characterId appears as a key in worker_job_titles or worker_shifts
          const inJobTitles = loc.worker_job_titles && Object.prototype.hasOwnProperty.call(loc.worker_job_titles, characterId);
          const inShifts = loc.worker_shifts && Object.prototype.hasOwnProperty.call(loc.worker_shifts, characterId);
          const inPayRates = loc.worker_pay_rates && Object.prototype.hasOwnProperty.call(loc.worker_pay_rates, characterId);
          if (inJobTitles || inShifts || inPayRates) {
            addLoc(loc);
          }
        });
      }

      return combined;
    },
    enabled: !!characterId && !!character,
    staleTime: 120000,
  });

  const getWorkLocationName = (locationId) => {
    if (!locationId) return null;
    const found = workLocations.find(l => l.id === locationId);
    return found?.name || null;
  };

  const getWorkShift = (locationId) => {
    if (!locationId) return null;
    const found = workLocations.find(l => l.id === locationId);
    if (!found) return null;
    const shift = found.worker_shifts?.[characterId];
    if (!shift?.start || !shift?.end) return null;
    const fmt = (t) => {
      const [h, m] = t.split(':').map(Number);
      const period = h >= 12 ? 'pm' : 'am';
      return `${h % 12 || 12}:${String(m).padStart(2, '0')}${period}`;
    };
    const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const days = shift.days?.map(d => DAY_LABELS[d]).join('/') || '';
    return `${fmt(shift.start)}–${fmt(shift.end)}${days ? ' · ' + days : ''}`;
  };

  const getReciprocal = () => {
    const settings = userSettings[0];
    if (!settings?.user_relatives || !character?.id) return null;
    const assignedRole = settings.user_relatives[character.id];
    if (!assignedRole) return null;
    return getReciprocalRole(assignedRole, settings.user_gender);
  };

  const zodiacSign = character?.birthday ? getZodiacSign(character.birthday) : (character?.zodiac_sign || null);
  const zodiacData = zodiacSign ? ZODIAC_SIGNS[zodiacSign] : null;
  const age = character?.birthday ? calculateAge(character.birthday) : null;

  const handleConvertNPC = useCallback((rel) => {
    setPromotingNPC({ rel, sourceCharacter: character });
  }, [character]);

  const handleNPCPromotionComplete = useCallback((avatarUrl) => {
    if (!promotingNPC) return;
    const { rel } = promotingNPC;
    const finalAvatarUrl = rel.photo_url || avatarUrl || null;
    const draft = {
      step: 0,
      avatarUrl: finalAvatarUrl,
      referenceUrls: finalAvatarUrl ? [finalAvatarUrl] : [],
      data: {
        first_name: rel.person_name?.split(" ")[0] || rel.person_name || "",
        middle_name: "",
        last_name: rel.person_name?.split(" ").slice(1).join(" ") || "",
        gender: "", age_range: "", ethnicities: [], living_situation: "",
        city: character?.city || "", state: character?.state || "",
        vibes: [], background: rel.description || rel.history_summary || "",
        archetype: "", social_energy: "", sexual_orientation: "",
        personality_override: rel.emotional_impact || "",
        situation_override: rel.current_status || "",
        memories: [],
        job_title: "", workplace_type: "", work_environment: "",
        occupation_description: "", criminal_record: "", zodiac_sign: "",
        frequented_places: [],
        known_character_relationships: character ? [{ character_id: character.id, relationship_type: rel.relationship_type || "Friend" }] : [],
        family_members: [],
        birthday: "",
        user_respect_level: rel.user_respect_level ?? 50,
        friendship_level: rel.friendship_level ?? 75,
        romantic_level: rel.romantic_level ?? 0,
        attraction_level: rel.attraction_level ?? 0,
        chosen_family_level: rel.chosen_family_level ?? 0,
        _npc_source_character_id: character?.id,
        _npc_source_rel: rel,
        _preserved_history: rel.history_summary || "",
        _preserved_last_interaction: rel.last_interaction_summary || "",
        _preserved_current_status: rel.current_status || "",
      }
    };
    localStorage.setItem(NPC_DRAFT_KEY, JSON.stringify(draft));
    setPromotingNPC(null);
    navigate("/create");
  }, [promotingNPC, character, navigate]);

  const handleZodiacSelect = async (sign) => {
    if (!character || character.is_default) return;
    
    setIsSavingZodiac(true);
    try {
      const birthdate = calculateBirthdateFromZodiac(sign, character.age_range);
      if (birthdate) {
        await base44.entities.Character.update(character.id, {
          birthday: birthdate,
          zodiac_sign: sign
        });
        refetch();
      }
    } catch (error) {
      console.error("Failed to set zodiac and birthdate:", error);
    } finally {
      setIsSavingZodiac(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
          <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
          <h2 className="text-sm font-semibold">Character Not Found</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 z-[1000] bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 pointer-events-auto">
        <Link to="/home" className="text-muted-foreground hover:text-foreground pointer-events-auto cursor-pointer"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-sm font-semibold flex-1">{character.name}</h2>
        <Link
          to={`/chat/${characterId}`}
          className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Open chat"
        >
          <MessageCircle className="w-4 h-4" />
        </Link>
        <button
          onClick={() => setShowEditSettings(true)}
          className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Edit profile fields"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowTroubleshooting(true)}
          className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Profile troubleshooting"
        >
          <Wrench className="w-4 h-4" />
        </button>
      </div>

      <ProfileTroubleshootingPanel
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
        characterId={characterId}
        characterName={character.name}
      />
      <CharacterEditSettingsPanel
        isOpen={showEditSettings}
        onClose={() => setShowEditSettings(false)}
        character={character}
        allCharacters={allCharacters}
        currentUser={currentUser}
      />

      <div className="max-w-lg mx-auto px-0 py-0 flex flex-col h-full">
        <ImageLightbox src={lightboxSrc} alt={character.name} onClose={() => setLightboxSrc(null)} />

        {/* ══ LOCKED TOP PROFILE AREA ══ */}
          <div className="px-6 py-6 space-y-6 border-b border-border">
            {/* Avatar, Name, Bio in one row */}
            <div className="flex gap-4 items-start">
              <button onClick={() => character.avatar_url && setLightboxSrc(character.avatar_url)} className={character.avatar_url ? "cursor-pointer flex-shrink-0" : "cursor-default flex-shrink-0"}>
                <CharacterAvatar character={character} size="lg" />
              </button>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-semibold text-foreground">{character.name}</h1>
                {character.profile_summary && (
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{character.profile_summary}</p>
                )}
              </div>
            </div>

            {/* Financial Summary — passes pre-fetched data from React Query cache.
                No internal fetch needed. Data is available as soon as the profile loads.
                characterFinancial may be null for legacy/new characters — component handles safely. */}
            <CharacterFinancialSummary
              characterId={characterId}
              character={character}
              financial={characterFinancial}
              onFinancialCreated={(rec) => queryClient.setQueryData(['characterFinancial', characterId], rec)}
            />

            {/* Narrative Biography */}
             {(character.backstory || character.background_story) && (
              <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
                {character.backstory && (
                  <div>
                    <p className="text-xs text-primary font-semibold uppercase tracking-wider mb-2">Backstory</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{character.backstory}</p>
                  </div>
                )}
                {character.background_story && (
                  <div className={character.backstory ? 'pt-3 border-t border-border' : ''}>
                    <p className="text-xs text-primary font-semibold uppercase tracking-wider mb-2">Background</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{character.background_story}</p>
                  </div>
                )}
              </div>
             )}

            {/* Your Connection card — left: metrics, right: In Their Own Words (feelings) */}
            <div className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-primary font-semibold uppercase tracking-wider">Your Connection</p>
                {(() => {
                  const reciprocal = getReciprocal();
                  const settings = userSettings[0];
                  const assignedRole = settings?.user_relatives?.[character?.id];
                  return reciprocal ? (
                    <div className="flex items-center gap-1 text-xs text-pink-400">
                      <Heart className="w-3 h-3 fill-current" />
                      <span className="capitalize text-[10px]">{getRelationshipLabel(assignedRole)} ↔ {getRelationshipLabel(reciprocal)}</span>
                    </div>
                  ) : null;
                })()}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Left: relationship bars */}
                <div className="space-y-3">
                  {[
                    { label: "Respect", value: character.user_respect_level ?? 50 },
                    { label: "Trust", value: character.trust_level ?? 50 },
                    { label: "Friendship", value: character.friendship_level ?? 75 },
                    { label: "Romantic", value: character.romantic_level ?? 0 },
                    { label: "Social Pull", value: character.attraction_level ?? 0 },
                    { label: "Chosen Family", value: character.chosen_family_level ?? 0 },
                    { label: "Jealousy", value: Math.round(((character.relational_jealousy ?? 0) + (character.envy_jealousy ?? 0)) / 2), sublabel: `relational ${character.relational_jealousy ?? 0}% · envy ${character.envy_jealousy ?? 0}%` }
                  ].map(({ label, value, sublabel }) => (
                    <div key={label}>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs font-medium text-foreground">{label}</span>
                        <span className="text-xs text-muted-foreground">{value}%</span>
                      </div>
                      {sublabel && <p className="text-[10px] text-muted-foreground/60 mb-1">{sublabel}</p>}
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Right: In Their Own Words */}
                <div className="border-l border-border pl-4">
                  <p className="text-xs text-primary font-semibold uppercase tracking-wider mb-3">In Their Own Words</p>
                  <CharacterFeelingsCard character={character} onRespectCorrected={refetch} />
                </div>
              </div>
            </div>

            {/* Row 2: Main Identity / Profile Information */}
            <div className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-primary" />
                <p className="text-xs text-primary font-semibold uppercase tracking-wider">Main Identity</p>
                {age !== null && (
                  <span className="text-xs text-muted-foreground ml-2">• {age} years old</span>
                )}
              </div>

              <div className="grid grid-cols-5 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider mb-1">City</p>
                  <p className="text-foreground font-medium">{character.city || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider mb-1">State</p>
                  <p className="text-foreground font-medium">{character.state || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider mb-1">Gender</p>
                  <p className="text-foreground font-medium">{character.gender || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider mb-1">Ethnicity</p>
                  <p className="text-foreground font-medium">{(character.ethnicities || []).join(", ") || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider mb-1">Orientation</p>
                  <p className="text-foreground font-medium">{character.sexual_orientation || "—"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border text-xs">
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider mb-1">Birthday & Zodiac</p>
                  {character.birthday ? (
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-medium">{format(new Date(character.birthday), "MMM d")}</span>
                      {zodiacData && <span className="text-lg">{zodiacData.emoji}</span>}
                    </div>
                  ) : (
                    <p className="text-muted-foreground italic">Not set</p>
                  )}
                </div>
                <div>
                  <HomeLocationField character={character} currentUser={currentUser} />
                </div>
              </div>
            </div>
          </div>

        {/* ══ SCROLLABLE COLLAPSIBLE GROUPS ══ */}
        <div className="flex-1 overflow-y-auto">
          {/* ══ GROUP 1: HOW THEY ARE DOING / WHAT SHAPED THEM ══ */}
        <div className="bg-card border-b border-border">
          <div className="px-4 py-2 bg-secondary/30">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">How They Are Doing / What Shaped Them</p>
          </div>
          
          <CollapsibleProfileSection icon={Activity} title="Dashboard">
            <CharacterDashboard character={character} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={BarChart3} title="Life Needs">
            <CharacterNeedsPanel character={character} onRefresh={() => refetch()} />
            <ManualNeedsEditor character={character} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={BookOpen} title="Life Journal">
            <LifeJournal characterId={characterId} character={character} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={AlertCircle} title="What They've Been Through">
            {(() => {
              const memories = character.memories || [];
              const categoryMeta = {
                challenges: { label: "Challenges", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20" },
                positive: { label: "Positive Experiences", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
                growth: { label: "Growth & Resilience", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
              };
              const categorized = { challenges: [], positive: [], growth: [], uncategorized: [] };
              memories.forEach(m => {
                const cat = m.category && categorized[m.category] !== undefined ? m.category : 'uncategorized';
                categorized[cat].push(m);
              });
              const hasAnyCategory = categorized.challenges.length > 0 || categorized.positive.length > 0 || categorized.growth.length > 0;
              return (
                <div className="space-y-4">
                  {memories.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      No experiences recorded yet. Experiences are added through the Edit Emotions &amp; Experiences page or as major life events occur.
                    </p>
                  )}
                  {hasAnyCategory && (
                    <div className="space-y-3">
                      {['challenges', 'positive', 'growth'].map(cat => {
                        const mems = categorized[cat];
                        if (mems.length === 0) return null;
                        const meta = categoryMeta[cat];
                        return (
                          <div key={cat}>
                            <p className={`text-[10px] font-bold uppercase tracking-widest ${meta.color} mb-1.5`}>{meta.label}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {mems.map((m, i) => {
                                const key = `${cat}-${i}`;
                                const isExpanded = expandedMemory === key;
                                const hasDetails = m.description || m.emotional_impact || m.lesson_learned;
                                return (
                                  <div key={i} className="w-full">
                                    <button
                                      onClick={() => hasDetails && setExpandedMemory(isExpanded ? null : key)}
                                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${meta.bg} ${meta.color} ${meta.border} ${hasDetails ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                                    >
                                      {m.title}{hasDetails ? ' ›' : ''}
                                    </button>
                                    {isExpanded && hasDetails && (
                                      <div className={`mt-1.5 mb-1 ml-1 p-3 rounded-xl border text-xs space-y-1 ${meta.bg} ${meta.border}`}>
                                        {m.description && <p className="text-foreground/80 leading-relaxed">{m.description}</p>}
                                        {m.emotional_impact && <p className={`${meta.color} mt-1`}><span className="font-medium">Impact: </span>{m.emotional_impact}</p>}
                                        {m.lesson_learned && <p className="text-muted-foreground mt-1"><span className="font-medium">Lesson: </span>{m.lesson_learned}</p>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {categorized.uncategorized.length > 0 && (
                    <div className={`space-y-3 ${hasAnyCategory ? 'pt-3 border-t border-border' : ''}`}>
                      {hasAnyCategory && <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Key Memories</p>}
                      {categorized.uncategorized.map((memory, idx) => (
                        <div key={idx} className="pb-3 border-b border-border last:border-b-0">
                          <p className="text-sm font-medium text-foreground">{memory.title}</p>
                          {memory.description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{memory.description}</p>}
                          {memory.emotional_impact && <p className="text-xs text-muted-foreground/70 mt-2"><span className="font-medium">Impact:</span> {memory.emotional_impact}</p>}
                          {memory.lesson_learned && <p className="text-xs text-muted-foreground/70 mt-1"><span className="font-medium">Lesson:</span> {memory.lesson_learned}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={GraduationCap} title="Education">
            <CharacterEducationSection character={character} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={AlertCircle} title="Criminal Record">
            <div className="bg-card border border-border rounded-2xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Criminal Record</p>
              <p className="text-sm text-foreground">{character.criminal_record || "No criminal record"}</p>
            </div>
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={Heart} title="Religion & Faith">
            <CharacterReligionSection character={character} />
          </CollapsibleProfileSection>
        </div>

        {/* ══ GROUP 2: HOW THEY COMMUNICATE ══ */}
        <div className="bg-card border-b border-border">
          <div className="px-4 py-2 bg-secondary/30">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">How They Communicate</p>
          </div>

          {character.personality_traits && character.personality_traits.length > 0 && (
            <CollapsibleProfileSection icon={Zap} title="Vibes">
              <div className="flex flex-wrap gap-2">
                {character.personality_traits.map(trait => (
                  <span key={trait} className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    {trait}
                  </span>
                ))}
              </div>
            </CollapsibleProfileSection>
          )}

          {character.communication_style && (
            <CollapsibleProfileSection icon={BookOpen} title="How They Talk">
              <p className="text-sm text-foreground leading-relaxed">{character.communication_style}</p>
            </CollapsibleProfileSection>
          )}

          <CollapsibleProfileSection icon={Zap} title="Traits & Quirks">
            <CharacterQuirksPanel character={character} />
          </CollapsibleProfileSection>
        </div>

        {/* ══ GROUP 3: HOW THEIR LIFE FUNCTIONS ══ */}
        <div className="bg-card border-b border-border">
          <div className="px-4 py-2 bg-secondary/30">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">How Their Life Functions</p>
          </div>

          <CollapsibleProfileSection icon={Briefcase} title="Income Sources">
            <div className="space-y-2">
              {workLocations.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground italic">No work locations linked yet.</p>
                  <button
                    onClick={async () => {
                      await base44.functions.invoke('syncEmploymentAssignments', {}).catch(() => {});
                      queryClient.invalidateQueries({ queryKey: ['workLocations', characterId] });
                      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
                    }}
                    className="text-xs text-primary/70 hover:text-primary underline underline-offset-2 transition-colors"
                  >
                    Sync employment data
                  </button>
                </div>
              )}
              {workLocations.map((loc) => {
                const payRate = loc.worker_pay_rates?.[characterId];
                const payType = loc.worker_pay_type?.[characterId];
                const jobTitle = loc.worker_job_titles?.[characterId];
                const shift = getWorkShift(loc.id);
                return (
                  <div key={loc.id} className="flex items-center justify-between text-xs pb-2 border-b border-border last:border-b-0">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Briefcase className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <span className="text-foreground font-medium truncate block">{loc.name}</span>
                        {jobTitle && <span className="text-muted-foreground/70 truncate block">{jobTitle}</span>}
                        {shift && <span className="text-muted-foreground/50 truncate block">{shift}</span>}
                      </div>
                    </div>
                    {payRate != null && (
                      <div className="text-right flex-shrink-0 ml-2 font-semibold text-green-300">
                        ${Number(payRate).toFixed(2)} {payType === 'hourly' ? '/hr' : payType === 'annual' || payType === 'salary' ? '/yr' : payType === 'monthly' ? '/mo' : payType === 'weekly' ? '/wk' : payType ? `/${payType}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={HomeIcon} title="Businesses / Properties">
            <CharacterBusinessesPanel characterId={characterId} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={BarChart3} title="Monthly Expenses">
            <CharacterExpenseManager characterId={characterId} readOnly={false} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={BarChart3} title="Monthly Statement">
            <MonthlyStatementPanel characterId={characterId} />
          </CollapsibleProfileSection>
        </div>

        {/* ══ GROUP 4: HOW THEY PRESENT THEMSELVES ══ */}
        <div className="bg-card border-b border-border">
          <div className="px-4 py-2 bg-secondary/30">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">How They Present Themselves</p>
          </div>

          <CollapsibleProfileSection icon={Shirt} title="Appearance Lock">
            <AppearanceLockEditor character={character} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={Camera} title="Appearance (Image Generation)">
            <AppearanceAgeField character={character} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={Shirt} title="Character Closet">
            <CharacterClosetPanel character={character} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={User} title="What They Call You">
            <NicknameForUserField character={character} />
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={BookOpen} title="Aliases / Also Known As">
            <CharacterAliasEditor character={character} />
          </CollapsibleProfileSection>
        </div>

        {/* ══ GROUP 5: EMOTIONAL & SOCIAL WORLD ══ */}
        <div className="bg-card border-b border-border">
          <div className="px-4 py-2 bg-secondary/30">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Emotional & Social World</p>
          </div>

          {(character.personality_summary || character.emotional_baggage || character.current_situation || character.upset_reaction || character.emotional_triggers_high?.length > 0 || character.emotional_triggers_medium?.length > 0 || character.emotional_triggers_deep?.length > 0) && (
            <CollapsibleProfileSection icon={Heart} title="Emotional Profile">
              <div className="space-y-4">
                {character.personality_summary && (
                  <div>
                    <p className="text-xs font-medium text-foreground mb-1">Personality Summary</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{character.personality_summary}</p>
                  </div>
                )}
                {character.current_situation && (
                  <div className={character.personality_summary ? 'pt-3 border-t border-border' : ''}>
                    <p className="text-xs font-medium text-foreground mb-1">Current Situation</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{character.current_situation}</p>
                  </div>
                )}
                {character.emotional_baggage && (
                  <div className={character.personality_summary || character.current_situation ? 'pt-3 border-t border-border' : ''}>
                    <p className="text-xs font-medium text-foreground mb-1">What They Carry</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{character.emotional_baggage}</p>
                  </div>
                )}
                {character.upset_reaction && (
                  <div className={character.personality_summary || character.current_situation || character.emotional_baggage ? 'pt-3 border-t border-border' : ''}>
                    <p className="text-xs font-medium text-foreground mb-1">When They're Upset</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{character.upset_reaction}</p>
                  </div>
                )}
                {character.emotional_triggers_high?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-rose-400 mb-1.5">High Triggers</p>
                    <div className="flex flex-wrap gap-1.5">
                      {character.emotional_triggers_high.map((t, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 text-xs border border-rose-500/20">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {character.emotional_triggers_medium?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-amber-400 mb-1.5">Medium Triggers</p>
                    <div className="flex flex-wrap gap-1.5">
                      {character.emotional_triggers_medium.map((t, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs border border-amber-500/20">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {character.emotional_triggers_deep?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-blue-400 mb-1.5">Deep Triggers</p>
                    <div className="flex flex-wrap gap-1.5">
                      {character.emotional_triggers_deep.map((t, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleProfileSection>
          )}

          <CollapsibleProfileSection icon={Users} title="Family">
            <FamilyEditor character={character} readOnly={false} allCharacters={allCharacters} currentUser={currentUser} userSettings={userSettings[0]} />
          </CollapsibleProfileSection>

          {character.family_history && (
            <CollapsibleProfileSection icon={BookOpen} title="Family History">
              <p className="text-sm text-muted-foreground leading-relaxed">{character.family_history}</p>
            </CollapsibleProfileSection>
          )}

          <CollapsibleProfileSection icon={Users} title="Characters They Know">
            <div className="space-y-4">
              {(character.fictional_relationships || [])
                .filter(r => {
                  if (!r.related_character_id) return false;
                  const lc = allCharacters.find(c => c.id === r.related_character_id);
                  if (!lc) return false;
                  return lc.character_type === "active_created_character";
                })
                .map((rel, idx) => {
                  const linkedChar = allCharacters.find(c => c.id === rel.related_character_id);
                  return (
                    <div key={idx} className="pb-4 border-b border-border last:border-b-0">
                      <div className="flex items-center gap-3 mb-3">
                        {linkedChar && <CharacterAvatar character={linkedChar} size="md" />}
                        <div>
                          <p className="text-sm font-medium text-foreground">{rel.person_name}</p>
                          <p className="text-xs text-primary font-medium capitalize">{rel.relationship_type}</p>
                        </div>
                      </div>
                      {rel.description && (
                        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{rel.description}</p>
                      )}
                      <div className="space-y-2">
                        {[
                          { label: "Respect", value: rel.user_respect_level ?? 50 },
                          { label: "Friendship", value: rel.friendship_level ?? 75 },
                          { label: "Romantic", value: rel.romantic_level ?? 0 },
                          { label: "Social Pull", value: rel.attraction_level ?? 0 },
                          { label: "Chosen Family", value: rel.chosen_family_level ?? 0 }
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <div className="flex justify-between mb-1">
                              <span className="text-xs font-medium text-foreground">{label}</span>
                              <span className="text-xs text-muted-foreground">{value}%</span>
                            </div>
                            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                              <div className="h-full bg-primary transition-all" style={{ width: `${value}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </CollapsibleProfileSection>

          <CollapsibleProfileSection icon={Ghost} title="People In Their World">
            <div className="space-y-4">
              <AddPeopleInTheirWorldPanel character={character} onSuccess={() => refetch()} />

              {(() => {
                const ownFamilyNames = new Set((character.family_members || []).map(m => m.name?.toLowerCase()));
                const worldRels = (character.fictional_relationships || []).filter(r => {
                  if (ownFamilyNames.has(r.person_name?.toLowerCase())) return false;
                  if (!r.related_character_id) return true;
                  const linked = allCharacters.find(c => c.id === r.related_character_id);
                  if (!linked) return true;
                  return linked.character_type !== "active_created_character";
                });
                const seen = new Set();
                const deduped = worldRels.filter(r => {
                  const key = r.person_name?.toLowerCase();
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
                return deduped.length > 0 ? (
                  <div className="space-y-5">
                    {deduped.map((rel, idx) => (
                      <div key={idx} className="pb-5 border-b border-border last:border-b-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            onClick={() => (rel.avatar_url || rel.photo_url) && setLightboxSrc(rel.avatar_url || rel.photo_url)}
                            className={(rel.avatar_url || rel.photo_url) ? "cursor-pointer" : "cursor-default"}
                          >
                            <div className="flex items-center gap-3">
                              {rel.avatar_url || rel.photo_url ? (
                                <div className="relative group">
                                  <img src={rel.avatar_url || rel.photo_url} alt={rel.person_name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <ZoomIn className="w-4 h-4 text-white" />
                                  </div>
                                </div>
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                                  <span className="text-xs font-semibold text-primary">{rel.person_name?.[0]?.toUpperCase() || "?"}</span>
                                </div>
                              )}
                              <div>
                                <p className="text-sm font-semibold text-foreground">{rel.person_name}</p>
                                <p className="text-xs text-primary font-medium capitalize">{rel.relationship_type}</p>
                              </div>
                            </div>
                          </button>
                        </div>
                        {rel.description && (
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Who they are</p>
                            <p className="text-xs text-foreground leading-relaxed">{rel.description}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}

              {(() => {
                const groupKeywords = ['class', 'group', 'people', 'team', 'meeting', 'event', 'program', 'session', 'training', 'workshop'];
                const filtered = (character.transient_encounters || []).filter(enc => {
                  const desc = (enc.description || '').toLowerCase();
                  const ctx = (enc.context || '').toLowerCase();
                  return !groupKeywords.some(kw => desc.includes(kw) || ctx.includes(kw));
                });
                return filtered.length > 0 ? (
                  <div className="space-y-3 pt-4 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Chance Encounters</p>
                    <div className="space-y-3">
                      {filtered.slice(0, 3).map((enc, idx) => (
                        <div key={idx} className="pb-2 border-b border-border/50 last:border-b-0">
                          <p className="text-xs text-foreground">{enc.description}</p>
                          {enc.context && (
                            <p className="text-xs text-muted-foreground/70">at {enc.context}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}
            </div>
          </CollapsibleProfileSection>
        </div>
        </div>
      </div>



      {/* Outfit Sharing Modal */}
      <AnimatePresence>
        {showOutfitSharer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 flex items-end"
            onClick={() => setShowOutfitSharer(false)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="w-full bg-card border-t border-border rounded-t-2xl max-h-96 overflow-y-auto p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">Pick an outfit to share</h3>
                <button onClick={() => setShowOutfitSharer(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!userSettings[0]?.user_closet || userSettings[0].user_closet.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No outfits in your closet yet.</p>
              ) : (
                <div className="space-y-2">
                  {userSettings[0].user_closet
                    .filter(item => item.type === "outfit" || (item.outfit_id && !item.piece_id))
                    .map((outfit, idx) => (
                      <button
                        key={outfit.outfit_id || idx}
                        onClick={async () => {
                          try {
                            await base44.entities.Message.create({
                              conversation_id: "shared",
                              sender_type: "user",
                              content: `Check out this outfit: ${outfit.label}`,
                              timestamp: new Date().toISOString(),
                            });
                            await base44.entities.Character.update(character.id, {
                              fictional_relationships: (character.fictional_relationships || []).map(r =>
                                r.person_name === character.name
                                  ? { ...r, _shared_outfit: outfit }
                                  : r
                              ),
                            });
                            setShowOutfitSharer(false);
                          } catch (e) {
                            console.error("Share failed:", e);
                          }
                        }}
                        className="w-full p-3 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors text-left"
                      >
                        <p className="text-sm font-medium text-foreground">{outfit.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{outfit.category}</p>
                      </button>
                    ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav />

      {promotingNPC && character && (
        <NPCPromotionModal
          npcData={promotingNPC.rel}
          sourceCharacter={promotingNPC.sourceCharacter}
          onComplete={handleNPCPromotionComplete}
          onCancel={() => setPromotingNPC(null)}
        />
      )}
    </div>
  );
}