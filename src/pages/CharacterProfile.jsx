import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Cake, BookOpen, Users, User, Ghost } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import FamilyEditor from "@/components/character/FamilyEditor";
import { EditableTextField, EditableSelectField, EditableEthnicityField, NonEditableField } from "@/components/character/ProfileFieldEditor";
import { format } from "date-fns";
import { calculateBirthdateFromZodiac } from "@/lib/zodiacUtils";

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

export default function CharacterProfile() {
  const { characterId } = useParams();
  const [isSavingZodiac, setIsSavingZodiac] = useState(false);
  
  const { data: character, isLoading, refetch } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      const chars = await base44.entities.Character.filter({ id: characterId });
      return chars[0] || null;
    },
    enabled: !!characterId,
    staleTime: 0,
  });

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list(),
  });

  const zodiacSign = character?.birthday ? getZodiacSign(character.birthday) : (character?.zodiac_sign || null);
  const zodiacData = zodiacSign ? ZODIAC_SIGNS[zodiacSign] : null;
  const age = character?.birthday ? calculateAge(character.birthday) : null;

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
        <h2 className="text-sm font-semibold">{character.name}</h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        {/* Avatar and Basic Info */}
        <div className="flex flex-col items-center gap-4">
          <CharacterAvatar character={character} size="xl" />
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
        {character.work_details && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Occupation</p>
            <div className="space-y-2">
              {character.work_details.job_title && (
                <p className="text-sm text-foreground"><span className="font-medium">Title:</span> {character.work_details.job_title}</p>
              )}
              {character.work_details.workplace_type && (
                <p className="text-sm text-foreground"><span className="font-medium">Type:</span> {character.work_details.workplace_type}</p>
              )}
              {character.work_details.work_environment && (
                <p className="text-sm text-foreground"><span className="font-medium">Environment:</span> {character.work_details.work_environment}</p>
              )}
            </div>
          </div>
        )}

        {/* Education */}
        {(character.current_education_activity || character.completed_education?.length > 0) && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Education</p>
            </div>
            {character.current_education_activity && character.current_education_activity !== "none" && (
              <div>
                <p className="text-xs font-medium text-foreground mb-1">Currently Learning</p>
                <p className="text-sm text-muted-foreground">{character.current_education_activity}</p>
              </div>
            )}
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
        <FamilyEditor character={character} readOnly={character.is_default} />

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

        {/* NPC / Fictional World Characters (no status bars — just rich details) */}
        {character.fictional_relationships?.some(r => !r.related_character_id) && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Ghost className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">People In Their World</p>
            </div>
            <div className="space-y-5">
              {character.fictional_relationships
                .filter(r => !r.related_character_id)
                .map((rel, idx) => (
                  <div key={idx} className="pb-5 border-b border-border last:border-b-0 space-y-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{rel.person_name}</p>
                      <p className="text-xs text-primary font-medium capitalize">{rel.relationship_type}</p>
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
          </div>
        )}

        {/* Transient Encounters */}
        {character.transient_encounters?.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <p className="text-xs font-medium text-foreground uppercase tracking-wider">One-off Encounters</p>
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

      </div>
      <BottomNav />
    </div>
  );
}