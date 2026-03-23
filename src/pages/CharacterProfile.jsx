import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Cake, Sparkles } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import { format } from "date-fns";

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
  
  const { data: character, isLoading } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      const chars = await base44.entities.Character.list();
      return chars.find(c => c.id === characterId);
    },
    enabled: !!characterId,
  });

  const zodiacSign = character?.birthday ? getZodiacSign(character.birthday) : null;
  const zodiacData = zodiacSign ? ZODIAC_SIGNS[zodiacSign] : null;

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
            <p className="text-sm text-muted-foreground mt-1">{character.personality_summary?.split(".")[0]}</p>
          </div>
        </div>

        {/* Location */}
        {(character.city || character.state) && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Location</p>
            <p className="text-sm text-foreground font-medium">
              {[character.city, character.state].filter(Boolean).join(", ")}
            </p>
          </div>
        )}

        {/* Birthday & Zodiac */}
        {character.birthday && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <Cake className="w-4 h-4 text-primary" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Birthday</p>
            </div>
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
          </div>
        )}

        {/* Work */}
        {character.work_details && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Work</p>
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

        {/* Relationship Stats */}
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
      </div>
      <BottomNav />
    </div>
  );
}