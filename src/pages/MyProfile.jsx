import React, { useState, useEffect } from "react";
import { useUserSettings } from "@/hooks/useUserSettings";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Sparkles, RefreshCw, DollarSign, Heart, Key, MapPin, Briefcase, Home } from "lucide-react";
import VGCRevenueDashboard from "@/components/finance/VGCRevenueDashboard";
import { Button } from "@/components/ui/button";
import UserAppearanceLockEditor from "@/components/user/UserAppearanceLockEditor";
import UserCharacterRelationshipSelector from "@/components/user/UserCharacterRelationshipSelector";
import BottomNav from "@/components/BottomNav";
import { getReciprocalRole, getRelationshipLabel, isFamilyRelationship } from "@/lib/relationshipUtils.js";

export default function MyProfile() {
  const queryClient = useQueryClient();
  const [narrative, setNarrative] = useState("");
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false);
  const [relativeRelationships, setRelativeRelationships] = useState({});

  const { data: user = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { settings, updateSettings } = useUserSettings();

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Character.filter({ created_by: user.email, status: "active" }, "-created_date", 100)
      : [],
    enabled: !!user?.email,
  });

  const { data: ownedLocations = [] } = useQuery({
    queryKey: ["userOwnedLocations", user?.id],
    queryFn: () => base44.entities.LocationReference.filter({ owner_character_id: user.id }),
    enabled: !!user?.id,
  });

  const { data: residentLocations = [] } = useQuery({
    queryKey: ["userResidentLocations", user?.id],
    queryFn: () => base44.entities.LocationReference.filter({ resident_character_ids: [user.id] }),
    enabled: !!user?.id,
  });

  const displayName = settings.fictional_world_name || user?.full_name || "You";
  const avatarUrl = user?.generated_avatar_urls?.[0] || user?.reference_image_urls?.[0] || null;
  const balance = settings.user_balance ?? 6000;
  const userGender = settings.user_gender || "other";

  // Sync local state from settings
  useEffect(() => {
    if (settings.user_relatives) {
      setRelativeRelationships(settings.user_relatives);
    }
  }, [JSON.stringify(settings.user_relatives)]);

  // Initialize balance if not set
  useEffect(() => {
    if (settings.id && settings.user_balance === undefined) {
      updateSettings({ user_balance: 6000 });
    }
  }, [settings.id, settings.user_balance]);

  const generateNarrative = async () => {
    setIsGeneratingNarrative(true);
    try {
      const charNames = characters.map(c => c.name).join(", ");
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Write a 5-sentence narrative about a person named "${displayName}" as seen from the perspective of the fictional characters around them. The characters in their world are: ${charNames || "various people"}. 
        
        Write it as if the characters were describing who "${displayName}" is to them — how they experience this person, what energy they bring, what role they play in people's lives. 
        
        Rules:
        - Written from the world's perspective, not the user's perspective
        - Dynamic and specific, not generic
        - Warm but honest — include a real observation or two
        - Do NOT make it sound like a resume or bio
        - Sound like something characters would actually say about a real person they know
        
        Return only the narrative text, no headers, no quotes.`,
      });
      setNarrative(typeof result === "string" ? result : JSON.stringify(result));
    } catch (err) {
      setNarrative("Something went wrong generating your narrative. Try again.");
    } finally {
      setIsGeneratingNarrative(false);
    }
  };

  useEffect(() => {
    if (characters.length > 0 && !narrative) {
      generateNarrative();
    }
  }, [characters.length]);

  /**
   * Assign or update a relationship between user and a character.
   * Also syncs the reciprocal entry into the character's family_members.
   */
  const handleAssignRelative = async (charId, relationship) => {
    const updated = { ...relativeRelationships };
    const character = characters.find(c => c.id === charId);
    if (!character) return;

    const oldRelationship = updated[charId];

    if (relationship) {
      updated[charId] = relationship;
    } else {
      delete updated[charId];
    }

    setRelativeRelationships(updated);

    // Persist to UserSettings
    updateSettings({ user_relatives: updated });

    // Sync reciprocal into character's family_members
    if (character && isFamilyRelationship(relationship || "")) {
      const reciprocal = relationship ? getReciprocalRole(relationship, userGender) : null;
      const currentFamilyMembers = character.family_members || [];

      // Remove old user entry (by _is_user flag)
      let updatedFamily = currentFamilyMembers.filter(m => !m._is_user);

      if (reciprocal) {
        // Calculate user's current age from birthday
        let userAge = null;
        if (settings.user_birthday) {
          const birth = new Date(settings.user_birthday);
          const today = new Date();
          userAge = today.getFullYear() - birth.getFullYear();
          const m = today.getMonth() - birth.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) userAge--;
        }
        const userAvatarUrl = user?.generated_avatar_urls?.[0] || user?.reference_image_urls?.[0] || null;
        updatedFamily = [
          ...updatedFamily,
          {
            name: displayName,
            relationship_type: reciprocal,
            _is_user: true,
            photo_url: userAvatarUrl,
            age_at_creation: userAge,
            age_set_date: new Date().toISOString(),
          }
        ];
      }

      await base44.entities.Character.update(charId, { family_members: updatedFamily }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["character", charId] });
      queryClient.invalidateQueries({ queryKey: ["characters", user?.email] });
    } else if (character && !relationship) {
      // Removing relationship — also remove from family list
      const updatedFamily = (character.family_members || []).filter(m => !m._is_user);
      await base44.entities.Character.update(charId, { family_members: updatedFamily }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["character", charId] });
    }
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-base font-bold text-foreground">Your Information</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="w-24 h-24 rounded-full bg-primary/20 ring-2 ring-primary/30 flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl font-bold text-primary">
                {displayName?.[0]?.toUpperCase() || "?"}
              </span>
            )}
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-foreground">{displayName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{user?.email}</p>
          </div>
        </div>

        {/* Financial balance */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Balance</p>
              <p className="text-2xl font-bold text-foreground">
                ${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Used for drinks, food, outings, activities, and gifts.</p>
        </div>

        {/* AI narrative */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground uppercase tracking-wider">How the world sees you</p>
            <button
              onClick={generateNarrative}
              disabled={isGeneratingNarrative}
              className="p-1.5 text-muted-foreground hover:text-primary transition-colors rounded-lg"
              title="Regenerate"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingNarrative ? "animate-spin" : ""}`} />
            </button>
          </div>

          {isGeneratingNarrative ? (
            <div className="flex items-center gap-2 py-4 text-muted-foreground">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span className="text-sm">Generating your narrative...</span>
            </div>
          ) : narrative ? (
            <p className="text-sm text-foreground leading-relaxed">{narrative}</p>
          ) : (
            <Button
              onClick={generateNarrative}
              variant="outline"
              size="sm"
              className="w-full rounded-xl gap-2"
            >
              <Sparkles className="w-4 h-4" /> Generate narrative
            </Button>
          )}
        </div>

        {/* Profile fields */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Profile</p>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Name</span>
              <span className="text-xs text-foreground font-medium">{user?.full_name || "—"}</span>
            </div>
            {settings.fictional_world_name && (
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">World name</span>
                <span className="text-xs text-foreground font-medium">{settings.fictional_world_name}</span>
              </div>
            )}
            {settings.user_birthday && (
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Birthday</span>
                <span className="text-xs text-foreground font-medium">{settings.user_birthday}</span>
              </div>
            )}
            {settings.user_gender && (
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Gender</span>
                <span className="text-xs text-foreground font-medium capitalize">{settings.user_gender}</span>
              </div>
            )}
            {settings.user_schedule_notes && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Schedule</span>
                <span className="text-xs text-foreground">{settings.user_schedule_notes}</span>
              </div>
            )}
          </div>
          <Link to="/settings">
            <button className="w-full mt-2 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
              Edit in Settings →
            </button>
          </Link>
        </div>

        {/* Owned Locations / Businesses */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-primary" />
            <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Businesses & Locations You Own</p>
          </div>
          <div className="space-y-2">
            {/* VGC Mobile — always listed as a user-owned in-world business */}
            <div className="flex items-start gap-2 p-2 rounded-xl bg-primary/5 border border-primary/20">
              <span className="text-base flex-shrink-0">📱</span>
              <div>
                <p className="text-sm text-foreground font-medium">VGC Mobile</p>
                <p className="text-xs text-muted-foreground">Phone company · Owner</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Characters pay monthly phone bills — revenue goes to you</p>
              </div>
            </div>
            {ownedLocations.map(loc => (
              <div key={loc.id} className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-foreground font-medium">{loc.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{loc.category || loc.location_type}</p>
                  {loc.owner_role && <p className="text-xs text-muted-foreground/70">{loc.owner_role}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* VGC Revenue Dashboard */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <VGCRevenueDashboard userSettings={settings} />
        </div>

        {/* Residences */}
        {residentLocations.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Home className="w-4 h-4 text-primary" />
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Where You Live</p>
            </div>
            <div className="space-y-2">
              {residentLocations.map(loc => (
                <div key={loc.id} className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-foreground font-medium">{loc.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{loc.category || loc.location_type}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User Aliases */}
        <UserAppearanceLockEditor settings={settings} user={user} />

        {/* Characters in their world — with full relationship selector */}
        {characters.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Characters in your world ({characters.length})
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Assign your relationship to each active character.
              </p>
            </div>
            <div className="space-y-4">
              {characters.map(char => {
                 const currentRelative = relativeRelationships[char.id];
                 const reciprocal = currentRelative ? getReciprocalRole(currentRelative, userGender) : null;
                 const hasKey = (settings.home_key_holders || []).some(k => k.character_id === char.id);

                 return (
                  <div key={char.id} className="pb-4 border-b border-border last:border-b-0">
                    <Link to={`/profile/${char.id}`}>
                      <div className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {char.avatar_url ? (
                            <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs font-bold text-primary">{char.name?.[0]}</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">{char.name}</p>
                          {char.archetype && <p className="text-xs text-muted-foreground">{char.archetype}</p>}
                        </div>
                        {hasKey && (
                          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30" title={`${char.name} gave you a key to their home`}>
                            <Key className="w-3 h-3 text-amber-400" />
                            <span className="text-[10px] text-amber-400 font-medium">Key</span>
                          </div>
                        )}
                      </div>
                    </Link>

                    <UserCharacterRelationshipSelector
                      character={char}
                      currentValue={currentRelative}
                      onSave={(rel) => handleAssignRelative(char.id, rel)}
                      onRemove={() => handleAssignRelative(char.id, null)}
                    />

                    {currentRelative && reciprocal && (
                      <p className="ml-11 mt-1.5 text-[10px] text-muted-foreground">
                        {char.name} sees you as: <span className="text-foreground font-medium capitalize">{getRelationshipLabel(reciprocal)}</span>
                      </p>
                    )}
                    {hasKey && (
                      <p className="ml-11 mt-1 text-[10px] text-amber-400/80 flex items-center gap-1">
                        <Key className="w-2.5 h-2.5" />
                        {char.name} gave you a key to their home
                      </p>
                    )}
                  </div>
                  );
                  })}
                  </div>
                  </div>
                  )}
                  </div>

      <BottomNav />
    </div>
  );
}