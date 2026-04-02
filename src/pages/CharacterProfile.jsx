import React, { useState, useCallback, useEffect } from "react";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Cake, BookOpen, Users, User, Ghost, Zap, Wrench, Briefcase, GraduationCap, MapPin, Camera } from "lucide-react";
import { useNavigate } from "react-router-dom";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import FamilyEditor from "@/components/character/FamilyEditor";
import CharacterFeelingsCard from "@/components/character/CharacterFeelingsCard";
import CharacterFinancialSummary from "@/components/character/CharacterFinancialSummary";
import { EditableTextField, EditableSelectField, EditableEthnicityField, NonEditableField } from "@/components/character/ProfileFieldEditor";
import { format } from "date-fns";
import { calculateBirthdateFromZodiac } from "@/lib/zodiacUtils";
import ProfileTroubleshootingPanel from "@/components/character/ProfileTroubleshootingPanel";
import NPCPromotionModal from "@/components/character/NPCPromotionModal";
import NPCPhotoEditor from "@/components/character/NPCPhotoEditor";

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
  const [isSavingZodiac, setIsSavingZodiac] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [promotingNPC, setPromotingNPC] = useState(null); // { rel, sourceCharacter }
  const [editingNPCPhoto, setEditingNPCPhoto] = useState(null); // { npc, sourceCharacter }
  const [lightboxSrc, setLightboxSrc] = useState(null);
  
  const { data: character, isLoading, refetch } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      const chars = await base44.entities.Character.filter({ id: characterId });
      return chars[0] || null;
    },
    enabled: !!characterId,
    staleTime: 0,
  });

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  const zodiacSign = character?.birthday ? getZodiacSign(character.birthday) : (character?.zodiac_sign || null);
  const zodiacData = zodiacSign ? ZODIAC_SIGNS[zodiacSign] : null;
  const age = character?.birthday ? calculateAge(character.birthday) : null;

  const handleConvertNPC = useCallback((rel) => {
    // Step 1: Show avatar selection modal BEFORE entering create flow
    setPromotingNPC({ rel, sourceCharacter: character });
  }, [character]);

  const handleNPCPromotionComplete = useCallback((avatarUrl) => {
    if (!promotingNPC) return;
    const { rel } = promotingNPC;
    // Use photo from the relationship (uploaded/generated via NPCPhotoEditor) OR the passed avatarUrl from NPCPromotionModal
    const finalAvatarUrl = rel.photo_url || avatarUrl || null;
    // Preload NPC data into Create Character draft — preserve ALL relationship data
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
        // Preserve all relationship data from the NPC
        known_character_relationships: character ? [{ character_id: character.id, relationship_type: rel.relationship_type || "Friend" }] : [],
        family_members: [],
        birthday: "",
        // CRITICAL: preserve all relationship levels and history
        user_respect_level: rel.user_respect_level ?? 50,
        friendship_level: rel.friendship_level ?? 75,
        romantic_level: rel.romantic_level ?? 0,
        attraction_level: rel.attraction_level ?? 0,
        chosen_family_level: rel.chosen_family_level ?? 0,
        _npc_source_character_id: character?.id,
        _npc_source_rel: rel,
        // Preserve history summary and context
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
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-sm font-semibold flex-1">{character.name}</h2>
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

        {/* Your Connection */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-4">Your Connection</p>
          <div className="space-y-3">
            {[
              { label: "Respect", value: character.user_respect_level ?? 50 },
              { label: "Friendship", value: character.friendship_level ?? 75 },
              { label: "Romantic", value: character.romantic_level ?? 0 },
              { label: "Attraction", value: character.attraction_level ?? 0 },
              { label: "Chosen Family", value: character.chosen_family_level ?? 0 }
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">{label}</span>
                  <span className="text-xs text-muted-foreground">{value}%</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            ))}
            <CharacterFeelingsCard character={character} />
          </div>
        </div>

        {/* Age, Location, Identity */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          {/* Age display — always read-only (ages dynamically) */}
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

          {/* City & State: locked for default, editable for custom */}
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

          {/* Gender: always displayed, never user-editable */}
          <NonEditableField label="Gender" value={character.gender} />

          {/* Ethnicity: locked for default, editable for custom */}
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

          {/* Sexual Orientation: always displayed, never user-editable */}
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

        {/* Work */}
        {(character.work_details || character.occupation_location_id || character.additional_occupation_locations?.length > 0) && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Occupation</p>
            <div className="space-y-3">
              {/* Primary job */}
              <div className="space-y-1">
                {character.work_details?.job_title && (
                  <p className="text-sm text-foreground font-medium">{character.work_details.job_title}</p>
                )}
                {character.occupation_location_name && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Briefcase className="w-3 h-3" /> {character.occupation_location_name}
                  </p>
                )}
                {character.work_details?.workplace_type && !character.occupation_location_name && (
                  <p className="text-sm text-muted-foreground">{character.work_details.workplace_type}</p>
                )}
              </div>
              {/* Additional jobs */}
              {character.additional_occupation_locations?.map((loc, idx) => (
                <div key={idx} className="pl-3 border-l-2 border-border space-y-0.5">
                  {loc.job_title && <p className="text-sm text-foreground font-medium">{loc.job_title}</p>}
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Briefcase className="w-3 h-3" /> {loc.location_name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Education */}
        {(character.current_education_activity || character.education_location_id || character.additional_education_locations?.length > 0 || character.completed_education?.length > 0) && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <GraduationCap className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Education</p>
            </div>
            {/* Primary education */}
            {(character.current_education_activity && character.current_education_activity !== "none") && (
              <div className="space-y-0.5">
                <p className="text-sm text-foreground font-medium">{character.education_details?.course_name || character.current_education_activity}</p>
                {character.education_location_name && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <GraduationCap className="w-3 h-3" /> {character.education_location_name}
                  </p>
                )}
              </div>
            )}
            {/* Additional education locations */}
            {character.additional_education_locations?.map((loc, idx) => (
              <div key={idx} className="pl-3 border-l-2 border-border space-y-0.5">
                {loc.program_name && <p className="text-sm text-foreground font-medium">{loc.program_name}</p>}
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <GraduationCap className="w-3 h-3" /> {loc.location_name}
                </p>
              </div>
            ))}
            {character.completed_education?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">Completed</p>
                <div className="space-y-1">
                  {character.completed_education.map((edu, idx) => (
                    <p key={idx} className="text-sm text-muted-foreground">
                      {edu.course_name}{edu.institution ? ` — ${edu.institution}` : ""}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Criminal Record */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Criminal Record</p>
          <p className="text-sm text-foreground">{character.criminal_record || "No criminal record"}</p>
        </div>

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

        {/* Family Members — read-only for default, editable for custom */}
        <FamilyEditor character={character} readOnly={character.is_default} allCharacters={allCharacters} />

        {/* Family History — below family list */}
        {character.family_history && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Family History</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{character.family_history}</p>
          </div>
        )}

        {/* Active App Characters They Know (with avatar + status bars) */}
        {(true) && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Characters They Know</p>
            </div>
            {(!character.fictional_relationships?.some(r => r.related_character_id)) && (
              <p className="text-sm text-muted-foreground italic">No active character relationships yet.</p>
            )}
            <div className="space-y-4">
              {(character.fictional_relationships || [])
                .filter(r => r.related_character_id)
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
                          { label: "Attraction", value: rel.attraction_level ?? 0 },
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

          {/* NPC relationships (includes family members synced in) — deduplicated by person_name */}
          {(() => {
            const npcRels = character.fictional_relationships?.filter(r => !r.related_character_id) || [];
            // Deduplicate: keep first occurrence of each person_name (case-insensitive)
            const seen = new Set();
            const deduped = npcRels.filter(r => {
              const key = r.person_name?.toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            return deduped.length > 0;
          })() ? (
            <div className="space-y-5">
              {(() => {
                const npcRels = character.fictional_relationships?.filter(r => !r.related_character_id) || [];
                // Deduplicate: keep first occurrence of each person_name (case-insensitive)
                const seen = new Set();
                const deduped = npcRels.filter(r => {
                  const key = r.person_name?.toLowerCase();
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
                return deduped;
              })()
                .map((rel, idx) => (
                  <div key={idx} className="pb-5 border-b border-border last:border-b-0 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <button
                            onClick={() => rel.photo_url && setLightboxSrc(rel.photo_url)}
                            className={rel.photo_url ? "cursor-pointer" : "cursor-default"}
                          >
                            <div className="flex items-center gap-2">
                              {rel.photo_url ? (
                                <img src={rel.photo_url} alt={rel.person_name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
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

          {/* Chance Encounters */}
          {character.transient_encounters?.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Chance Encounters</p>
              <div className="space-y-3">
                {character.transient_encounters.map((enc, idx) => (
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

        {/* Nickname for User */}
        <NicknameForUserField character={character} />

      </div>
      <BottomNav />

      {/* NPC Photo Editor */}
      {editingNPCPhoto && (
        <NPCPhotoEditor
          npc={editingNPCPhoto.npc}
          sourceCharacter={editingNPCPhoto.sourceCharacter}
          onPhotoUpdate={(photoUrl) => {
            // Update the NPC's photo in their source character
            const sourceChar = editingNPCPhoto.sourceCharacter;
            const updatedRels = (sourceChar.fictional_relationships || []).map(r =>
              r.person_name === editingNPCPhoto.npc.person_name
                ? { ...r, photo_url: photoUrl }
                : r
            );
            base44.entities.Character.update(sourceChar.id, { fictional_relationships: updatedRels })
              .then(() => refetch())
              .catch(() => {});
          }}
          onClose={() => setEditingNPCPhoto(null)}
        />
      )}

      {/* NPC Promotion Modal — avatar step before create flow */}
      {promotingNPC && (
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