import React, { useState, useCallback, useEffect } from "react";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Cake, BookOpen, Users, User, Ghost, Zap, Wrench, Briefcase, GraduationCap, MapPin, Camera, ZoomIn, Heart, Settings, Clock, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import FamilyEditor from "@/components/character/FamilyEditor";
import CharacterFeelingsCard from "@/components/character/CharacterFeelingsCard";
import CharacterFinancialSummary from "@/components/character/CharacterFinancialSummary";
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
import { resolveEmployment } from "@/lib/employmentResolver.js";


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
  
  const { data: character, isLoading, refetch } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      const chars = await base44.entities.Character.filter({ id: characterId });
      if (chars[0]) {
        const { system_prompt, ...char } = chars[0];
        return char;
      }
      return null;
    },
    enabled: !!characterId,
    staleTime: 0,
  });

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
    staleTime: 60000,
  });

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email || ""],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      await new Promise(r => setTimeout(r, 400));
      const chars = await base44.entities.Character.filter({ owner_email: currentUser.email });
      return chars.map(({ system_prompt, ...char }) => char);
    },
    enabled: !!currentUser?.email,
    staleTime: 30000,
  });

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 800));
      return base44.entities.UserSettings.list();
    },
    staleTime: 60000,
  });

  const { data: workLocations = [] } = useQuery({
    queryKey: ['workLocations', characterId],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 1200));
      return base44.entities.LocationReference.filter({ worker_character_ids: [characterId] });
    },
    enabled: !!characterId,
    staleTime: 30000,
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
      />

      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <ImageLightbox src={lightboxSrc} alt={character.name} onClose={() => setLightboxSrc(null)} />

        {/* Avatar and Basic Info */}
        <div className="flex flex-col items-center gap-4">
          <button onClick={() => character.avatar_url && setLightboxSrc(character.avatar_url)} className={character.avatar_url ? "cursor-pointer" : "cursor-default"}>
            <CharacterAvatar character={character} size="xl" />
          </button>
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-foreground">{character.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {character.is_default
                ? "He grew up developing a keen instinct for authenticity from varied environments, now works in NYC retail, and builds his life on intention and control."
                : character.id === "69c05643cad0c019b157815c"
                ? "Currently in-between jobs and holding various certifications, he recently completed a draining shift at the community center."
                : character.personality_summary?.split(".")[0]}
            </p>
          </div>
        </div>

        {/* Financial Summary */}
        <CharacterFinancialSummary characterId={characterId} />

        {/* Monthly Statement */}
        <MonthlyStatementPanel characterId={characterId} />

        {/* Monthly Expenses */}
        <CharacterExpenseManager characterId={characterId} readOnly={character.is_default} />

        {/* Your Connection */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Your Connection</p>
            {(() => {
              const reciprocal = getReciprocal();
              const settings = userSettings[0];
              const assignedRole = settings?.user_relatives?.[character?.id];
              return reciprocal ? (
                <div className="space-y-0.5 text-right">
                  <div className="flex items-center gap-1 text-xs text-pink-400">
                    <Heart className="w-3 h-3 fill-current" />
                    <span className="capitalize">{getRelationshipLabel(assignedRole)} ↔ {getRelationshipLabel(reciprocal)}</span>
                  </div>
                </div>
              ) : null;
            })()}
          </div>
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
                  <div 
                    className="h-full bg-primary transition-all"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
              ))}
            <CharacterFeelingsCard character={character} onRespectCorrected={refetch} />
          </div>
        </div>

        {/* Age, Location, Identity */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          {(age !== null || character.age_range) && (
            <div className="flex items-center gap-2 pb-2 border-b border-border">
              <User className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground font-medium">
                {age !== null ? `${age} years old` : character.age_range}
              </span>
              {age !== null && character.age_range && (
                <span className="text-xs text-muted-foreground">({character.age_range})</span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {character.is_default ? (
              <>
                <NonEditableField label="City" value={character.city} />
                <NonEditableField label="State" value={character.state} />
              </>
            ) : (
              <>
                <EditableTextField character={character} field="city" label="City" placeholder="City" />
                <EditableTextField character={character} field="state" label="State" placeholder="State" />
              </>
            )}
          </div>

          <NonEditableField label="Gender" value={character.gender} />

          {character.is_default ? (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Ethnic Background</p>
              <div className="flex flex-wrap gap-1.5">
                {(character.ethnicities || []).length > 0
                  ? character.ethnicities.map(eth => (
                      <span key={eth} className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{eth}</span>
                    ))
                  : <span className="text-sm text-muted-foreground italic">Not set</span>
                }
              </div>
            </div>
          ) : (
            <EditableEthnicityField character={character} />
          )}

          <NonEditableField label="Orientation" value={character.sexual_orientation} />
        </div>

        {/* Birthday & Zodiac */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Cake className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Birthday & Zodiac</p>
          </div>
          {character.birthday ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground font-medium">
                  {format(new Date(character.birthday), "MMMM d")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(character.birthday), "EEEE")}
                </p>
              </div>
              {zodiacData && (
                <div className="text-right">
                  <p className="text-3xl">{zodiacData.emoji}</p>
                  <p className="text-xs text-muted-foreground mt-1 capitalize">{zodiacSign}</p>
                  <p className="text-xs text-muted-foreground">{zodiacData.dates}</p>
                </div>
              )}
            </div>
          ) : !character.is_default ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground italic">No birthday set. Pick a zodiac sign to auto-generate one.</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.keys(ZODIAC_SIGNS).map(sign => (
                  <button
                    key={sign}
                    onClick={() => handleZodiacSelect(sign)}
                    disabled={isSavingZodiac}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg border border-border hover:border-primary/40 transition-colors disabled:opacity-50"
                  >
                    <span className="text-2xl">{ZODIAC_SIGNS[sign].emoji}</span>
                    <span className="text-xs capitalize text-muted-foreground hover:text-foreground">{sign}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No birthday set</p>
          )}
        </div>

        {/* Biography & Background */}
        {(character.background_story || character.current_situation) && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Biography & Background</p>
            {character.background_story && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">Background</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{character.background_story}</p>
              </div>
            )}
            {character.current_situation && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">Current Situation</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{character.current_situation}</p>
              </div>
            )}
          </div>
        )}

        {/* Work / School Details */}
        {(() => {
          // Use shared employment resolver — single source of truth
          const empResult = resolveEmployment(character, workLocations);

          // Map resolver jobs to display shape
          const jobs = empResult.jobs.map((job, idx) => ({
            key: `job-${idx}`,
            jobTitle: job.job_title,
            locationName: job.location_name,
            isRabbitHole: !!(job.location_id && !job.location_name),
            schedule: job.schedule_label,
            isDefault: job.is_default_schedule,
          }));

          // School enrollments from character file
          const schoolEnrollments = [];
          if (character.current_education_activity && character.current_education_activity !== 'none') {
            schoolEnrollments.push({
              key: 'primary-school',
              locationName: character.education_location_name || null,
              program: character.education_details?.course_name || character.current_education_activity,
              schedule: null,
            });
          }
          (character.additional_education_locations || []).forEach((loc, idx) => {
            if (!loc.location_name && !loc.program_name) return;
            schoolEnrollments.push({
              key: `school-${idx}`,
              locationName: loc.location_name || null,
              program: loc.program_name || null,
              schedule: null,
            });
          });

          const hasWork = jobs.length > 0;
          const hasSchool = schoolEnrollments.length > 0;
          const hasAny = hasWork || hasSchool;

          if (!hasAny) return null;

          return (
            <div className="bg-card border border-border rounded-2xl p-4 space-y-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Work / School Details</p>

              {/* JOBS */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 mb-2">
                  <Briefcase className="w-3.5 h-3.5 text-primary" />
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Jobs</p>
                </div>
                {jobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic pl-1">No work details assigned.</p>
                ) : (
                  <div className="space-y-3">
                    {jobs.map((job, i) => (
                      <div key={job.key} className={`space-y-0.5 ${i > 0 ? 'pl-3 border-l-2 border-border' : ''}`}>
                        {job.jobTitle && (
                          <p className="text-sm text-foreground font-medium">{job.jobTitle}</p>
                        )}
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span>{job.locationName || (job.isRabbitHole ? 'Rabbit Hole / Off-App Location' : 'Location not set')}</span>
                        </div>
                        {job.schedule && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            <span>{job.schedule}</span>
                            {job.isDefault && <span className="text-[10px] text-muted-foreground/50 ml-1">(default)</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SCHOOL */}
              <div className="space-y-1 pt-3 border-t border-border">
                <div className="flex items-center gap-1.5 mb-2">
                  <GraduationCap className="w-3.5 h-3.5 text-primary" />
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">School</p>
                </div>
                {schoolEnrollments.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic pl-1">No school details assigned.</p>
                ) : (
                  <div className="space-y-3">
                    {schoolEnrollments.map((enr, i) => (
                      <div key={enr.key} className={`space-y-0.5 ${i > 0 ? 'pl-3 border-l-2 border-border' : ''}`}>
                        {enr.program && (
                          <p className="text-sm text-foreground font-medium">{enr.program}</p>
                        )}
                        {enr.locationName && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="w-3 h-3 flex-shrink-0" />
                            <span>{enr.locationName}</span>
                          </div>
                        )}
                        {enr.schedule && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            <span>{enr.schedule}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <CharacterWorkScheduleEditor character={character} />
            </div>
          );
        })()}

        {/* Businesses */}
        <CharacterBusinessesPanel characterId={characterId} />

        {/* Completed Education — kept separate so history is not lost */}
        {(character.completed_education?.length > 0) && (() => {
          const now = new Date();
          const completedItems = (character.completed_education || []).filter(edu => {
            if (!edu.completion_date) return false;
            return new Date(edu.completion_date) <= now;
          });
          if (completedItems.length === 0) return null;
          return (
            <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-primary" />
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Completed Education</p>
              </div>
              <div className="space-y-1">
                {completedItems.map((edu, idx) => {
                  const modeLabel = edu.mode === 'in_person' ? 'In-Person' : edu.mode === 'remote_scheduled' ? 'Remote' : edu.mode === 'on_demand' ? 'On-Demand' : null;
                  return (
                    <div key={idx}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm text-muted-foreground">
                          {edu.course_name}{edu.institution ? ` — ${edu.institution}` : ""}
                        </p>
                        {modeLabel && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{modeLabel}</span>
                        )}
                      </div>
                      {edu.completion_date && (
                        <p className="text-xs text-muted-foreground/60">
                          Completed {format(new Date(edu.completion_date), "MMM yyyy")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Home Location */}
        <HomeLocationField character={character} currentUser={currentUser} />

        {/* Criminal Record */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Criminal Record</p>
          <p className="text-sm text-foreground">{character.criminal_record || "No criminal record"}</p>
        </div>

        {/* Life Journal */}
        <LifeJournal characterId={characterId} character={character} />

        {/* Live Needs — Active Created Characters only */}
        <CharacterNeedsPanel
          character={character}
          onRefresh={() => refetch()}
        />

        {/* Manual Needs Override — for debugging/repair */}
        <ManualNeedsEditor character={character} />

        {/* Key Life Events & Memories */}
        {character.memories?.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Key Life Events & Memories</p>
            <div className="space-y-3">
              {character.memories.map((memory, idx) => (
                <div key={idx} className="pb-3 border-b border-border last:border-b-0">
                  <p className="text-sm font-medium text-foreground">{memory.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{memory.description}</p>
                  {memory.emotional_impact && (
                    <p className="text-xs text-muted-foreground/70 mt-2"><span className="font-medium">Impact:</span> {memory.emotional_impact}</p>
                  )}
                  {memory.lesson_learned && (
                    <p className="text-xs text-muted-foreground/70 mt-1"><span className="font-medium">Lesson:</span> {memory.lesson_learned}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Family Members */}
        <FamilyEditor character={character} readOnly={character.is_default} allCharacters={allCharacters} currentUser={currentUser} userSettings={userSettings[0]} />

        {/* Family History */}
        {character.family_history && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Family History</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{character.family_history}</p>
          </div>
        )}

        {/* Characters They Know */}
        {(true) && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Characters They Know</p>
            </div>
            {(!character.fictional_relationships?.some(r => {
              if (!r.related_character_id) return false;
              const lc = allCharacters.find(c => c.id === r.related_character_id);
              if (!lc) return false;
              return lc.character_type === "active_created_character";
            })) && (
              <p className="text-sm text-muted-foreground italic">No character relationships yet.</p>
            )}
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
                      {rel.current_status && (
                        <div className="mb-2">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">What's going on now</p>
                          <p className="text-xs text-foreground leading-relaxed">{rel.current_status}</p>
                        </div>
                      )}
                      {rel.emotional_impact && (
                        <div className="mb-2">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">How they feel right now</p>
                          <p className="text-xs text-muted-foreground leading-relaxed italic">{rel.emotional_impact}</p>
                        </div>
                      )}
                      {rel.last_interaction_summary && (
                        <div className="mb-3">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Last interaction</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">{rel.last_interaction_summary}</p>
                        </div>
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
          </div>
        )}

        {/* NPC / Fictional World Characters + Transient Encounters */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Ghost className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">People In Their World</p>
          </div>

          <AddPeopleInTheirWorldPanel character={character} onSuccess={() => refetch()} />

          {(() => {
            // Routing rule (type-based only, relationship type is irrelevant):
            // → active_created_character = Characters They Know (separate section above)
            // → this character's own family_members array = Family (FamilyEditor below)
            // → everything else = People in Their World (catch-all)
            const ownFamilyNames = new Set((character.family_members || []).map(m => m.name?.toLowerCase()));
            const worldRels = (character.fictional_relationships || []).filter(r => {
              // Exclude this character's own family entries
              if (ownFamilyNames.has(r.person_name?.toLowerCase())) return false;
              // Unlinked entries always belong here
              if (!r.related_character_id) return true;
              // Linked: exclude active_created_character (they go to "Characters They Know")
              const linked = allCharacters.find(c => c.id === r.related_character_id);
              if (!linked) return true; // linked ID not found in scope → show here
              return linked.character_type !== "active_created_character";
            });
            const seen = new Set();
            const deduped = worldRels.filter(r => {
              const key = r.person_name?.toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            return deduped.length > 0;
          })() ? (
            <div className="space-y-5">
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
                return worldRels.filter(r => {
                  const key = r.person_name?.toLowerCase();
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
              })()
                .map((rel, idx) => (
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
                          {!rel._from_family && (
                            <div className="flex gap-1 flex-shrink-0">
                              <button
                                onClick={() => setEditingNPCPhoto({ npc: rel, sourceCharacter: character })}
                                title="Upload or generate photo"
                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
                              >
                                <Camera className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleConvertNPC(rel)}
                                title="Convert to active character"
                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                              >
                                <Zap className="w-3 h-3" /> Activate
                              </button>
                            </div>
                          )}
                    </div>
                    {rel.description && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Who they are</p>
                        <p className="text-xs text-foreground leading-relaxed">{rel.description}</p>
                      </div>
                    )}
                    {rel.history_summary && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">History</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{rel.history_summary}</p>
                      </div>
                    )}
                    {rel.current_status && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">What's going on now</p>
                        <p className="text-xs text-foreground leading-relaxed">{rel.current_status}</p>
                      </div>
                    )}
                    {rel.emotional_impact && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">How they feel about them</p>
                        <p className="text-xs text-muted-foreground leading-relaxed italic">{rel.emotional_impact}</p>
                      </div>
                    )}
                    {rel.last_interaction_summary && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Last interaction</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{rel.last_interaction_summary}</p>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            !character.transient_encounters?.length && (
              <p className="text-sm text-muted-foreground italic">No people in their world yet.</p>
            )
          )}

          {(() => {
            const groupKeywords = ['class', 'group', 'people', 'team', 'meeting', 'event', 'program', 'session', 'training', 'workshop'];
            const filtered = (character.transient_encounters || []).filter(enc => {
              const desc = (enc.description || '').toLowerCase();
              const ctx = (enc.context || '').toLowerCase();
              return !groupKeywords.some(kw => desc.includes(kw) || ctx.includes(kw));
            });
            return filtered.length > 0;
          })() && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Chance Encounters</p>
              <div className="space-y-3">
                {(() => {
                  const groupKeywords = ['class', 'group', 'people', 'team', 'meeting', 'event', 'program', 'session', 'training', 'workshop'];
                  return (character.transient_encounters || []).filter(enc => {
                    const desc = (enc.description || '').toLowerCase();
                    const ctx = (enc.context || '').toLowerCase();
                    return !groupKeywords.some(kw => desc.includes(kw) || ctx.includes(kw));
                  }).slice(0, 3);
                })().map((enc, idx) => (
                  <div key={idx} className="pb-2 border-b border-border/50 last:border-b-0">
                    <p className="text-xs text-foreground">{enc.description}</p>
                    {enc.context && (
                      <p className="text-xs text-muted-foreground/70">at {enc.context}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Personality Traits */}
        {character.personality_traits && character.personality_traits.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Vibes</p>
            <div className="flex flex-wrap gap-2">
              {character.personality_traits.map(trait => (
                <span key={trait} className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  {trait}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Communication Style */}
        {character.communication_style && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">How They Talk</p>
            <p className="text-sm text-foreground leading-relaxed">{character.communication_style}</p>
          </div>
        )}

        {/* Aliases */}
        <CharacterAliasEditor character={character} />

        {/* Appearance Age override for image generation */}
        <AppearanceAgeField character={character} />

        {/* Appearance Lock */}
        <AppearanceLockEditor character={character} />

        {/* Personality Quirks */}
        <CharacterQuirksPanel character={character} />

        {/* Character Closet */}
        <CharacterClosetPanel character={character} />

        {/* Share Outfit with Character */}
        {!character.is_default && character?.fictional_relationships?.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Share Your Outfit</p>
              <button
                onClick={() => setShowOutfitSharer(true)}
                className="text-xs text-primary font-medium hover:opacity-70 transition-opacity"
              >
                Send an outfit
              </button>
            </div>
            <p className="text-xs text-muted-foreground/70">Give a character one of your outfits to show your style.</p>
          </div>
        )}

        {/* Nickname for User */}
        <NicknameForUserField character={character} />

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

      {editingNPCPhoto && character && (
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