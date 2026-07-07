import React, { useState, useEffect } from "react";
import { useUserSettings } from "@/hooks/useUserSettings";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Sparkles, RefreshCw, DollarSign, Key, MapPin, Briefcase,
  Home, Phone, Send, User, Eye, Wallet, Shirt, Palette, Users, ChevronRight,
  TrendingUp, Pencil, Settings as SettingsIcon, ChevronDown, ChevronUp,
} from "lucide-react";
import ProfileAnalytics from "@/components/profile/ProfileAnalytics";
import { Button } from "@/components/ui/button";
import UserAppearanceLockEditor from "@/components/user/UserAppearanceLockEditor";
import UserClosetPanel from "@/components/user/UserClosetPanel";
import UserCharacterRelationshipSelector from "@/components/user/UserCharacterRelationshipSelector";
import BottomNav from "@/components/BottomNav";
import ProfileSectionHeader from "@/components/profile/ProfileSectionHeader";
import LocationImageUploader from "@/components/profile/LocationImageUploader";
import { useUserActiveOutfit } from "@/lib/activeOutfitResolver";
import { getReciprocalRole, getRelationshipLabel, isFamilyRelationship } from "@/lib/relationshipUtils.js";

export default function MyProfile() {
  const queryClient = useQueryClient();
  const [narrative, setNarrative] = useState("");
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false);
  const [relativeRelationships, setRelativeRelationships] = useState({});
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [showClosetEditor, setShowClosetEditor] = useState(false);
  const [showAppearanceEditor, setShowAppearanceEditor] = useState(false);
  const [showCharacterManager, setShowCharacterManager] = useState(false);

  const { data: user = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { settings, updateSettings } = useUserSettings();

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["userSettings"] });
  }, []);

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Character.filter({ owner_email: user.email, status: "active" }, "-created_date", 100)
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

  // Resolve the user's home/current residence location from settings.user_current_location_id.
  // Falls back to residentLocations[0] when no explicit current location is set.
  const homeLocationId = settings.user_current_location_id || residentLocations[0]?.id || null;
  const { data: homeLocation = null } = useQuery({
    queryKey: ["userHomeLocation", homeLocationId],
    queryFn: () => base44.entities.LocationReference.get(homeLocationId),
    enabled: !!homeLocationId,
  });

  const displayName = settings.fictional_world_name || user?.full_name || "You";
  const avatarUrl = user?.generated_avatar_urls?.[0] || user?.reference_image_urls?.[0] || null;
  const balance = settings.user_balance ?? 6000;
  const vgcRevenue = settings.vgc_mobile_revenue ?? 0;
  const userGender = settings.user_gender || "other";

  // Active outfit for compact closet summary
  const activeOutfitResult = useUserActiveOutfit(settings);
  const activeOutfit = activeOutfitResult?.outfit || null;

  useEffect(() => {
    if (settings.user_relatives) {
      setRelativeRelationships(settings.user_relatives);
    }
  }, [JSON.stringify(settings.user_relatives)]);

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

  const handleAssignRelative = async (charId, relationship) => {
    const updated = { ...relativeRelationships };
    const character = characters.find(c => c.id === charId);
    if (!character) return;

    if (relationship) {
      updated[charId] = relationship;
    } else {
      delete updated[charId];
    }

    setRelativeRelationships(updated);
    updateSettings({ user_relatives: updated });

    if (character && isFamilyRelationship(relationship || "")) {
      const reciprocal = relationship ? getReciprocalRole(relationship, userGender) : null;
      const currentFamilyMembers = character.family_members || [];
      let updatedFamily = currentFamilyMembers.filter(m => !m._is_user);

      if (reciprocal) {
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
      const updatedFamily = (character.family_members || []).filter(m => !m._is_user);
      await base44.entities.Character.update(charId, { family_members: updatedFamily }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["character", charId] });
    }
  };

  const fmtMoney = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const memberSince = user?.created_date ? new Date(user.created_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—";

  // Appearance lock traits for compact display
  const appearanceTraits = settings.appearance_lock
    ? [
        { label: "Height", value: settings.appearance_lock.height_display },
        { label: "Skin", value: settings.appearance_lock.skin_tone },
        { label: "Hair", value: settings.appearance_lock.hairstyle },
        { label: "Facial Hair", value: settings.appearance_lock.facial_hair },
        { label: "Style", value: settings.appearance_lock.clothing_style },
        { label: "Footwear", value: settings.appearance_lock.footwear },
      ].filter(t => t.value)
    : [];

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* ── STICKY HEADER ── */}
      <div className="sticky top-0 z-30 bg-gradient-to-b from-background via-background/95 to-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-base font-bold text-foreground flex-1">Your Information</h1>
        <Link to="/settings" className="text-muted-foreground hover:text-primary transition-colors">
          <SettingsIcon className="w-5 h-5" />
        </Link>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-8">

        {/* ═══ MODULE 1: HERO + FINANCIAL CARDS ═══ */}
        <section className="space-y-5">
          {/* Hero — left-aligned with profile pic + info */}
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/30 to-accent/15 blur-lg scale-110" />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-accent/10 ring-2 ring-primary/30 flex items-center justify-center overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-bold text-primary">
                    {displayName?.[0]?.toUpperCase() || "?"}
                  </span>
                )}
              </div>
              <Link to="/settings" className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center shadow-lg hover:border-primary/40 transition-colors">
                <Pencil className="w-3 h-3 text-muted-foreground" />
              </Link>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-foreground truncate">{displayName}</h2>
              <p className="text-[10px] text-muted-foreground/70 truncate font-mono">{user?.id}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Member since {memberSince}</span>
                {settings.user_gender && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize font-medium">{settings.user_gender}</span>
                )}
              </div>
            </div>
          </div>

          {/* Financial summary — two equal cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-card border border-border rounded-2xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-green-500/5 rounded-full blur-2xl" />
              <div className="relative">
                <div className="w-9 h-9 rounded-xl bg-green-500/10 flex items-center justify-center mb-3">
                  <Wallet className="w-4 h-4 text-green-500" />
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Your Balance</p>
                <p className="text-xl font-bold text-foreground">${fmtMoney(balance)}</p>
                <p className="text-[10px] text-muted-foreground mt-1.5">Personal spending</p>
              </div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/5 rounded-full blur-2xl" />
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <Phone className="w-4 h-4 text-blue-500" />
                  </div>
                  {vgcRevenue > 0 && (
                    <button
                      onClick={() => setShowTransferModal(true)}
                      className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      title="Transfer to balance"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">VGC Revenue</p>
                <p className="text-xl font-bold text-foreground">${fmtMoney(vgcRevenue)}</p>
                <p className="text-[10px] text-muted-foreground mt-1.5">Character phone bills</p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ MODULE 2: HOW THE WORLD SEES YOU — full width, highlighted ═══ */}
        <section className="bg-gradient-to-br from-primary/10 via-card to-card border border-primary/20 rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-primary/10 rounded-full blur-3xl" />
          <div className="relative">
            <ProfileSectionHeader
              icon={Eye}
              title="How the World Sees You"
              action={
                <button
                  onClick={generateNarrative}
                  disabled={isGeneratingNarrative}
                  className="p-2 text-muted-foreground hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                  title="Regenerate"
                >
                  <RefreshCw className={`w-4 h-4 ${isGeneratingNarrative ? "animate-spin" : ""}`} />
                </button>
              }
            />
            {isGeneratingNarrative ? (
              <div className="flex items-center gap-2 py-3 text-muted-foreground">
                <Sparkles className="w-4 h-4 animate-pulse text-primary" />
                <span className="text-sm">Generating your narrative...</span>
              </div>
            ) : narrative ? (
              <p className="text-sm text-foreground/90 leading-relaxed italic">"{narrative}"</p>
            ) : (
              <Button onClick={generateNarrative} variant="outline" size="sm" className="w-full rounded-xl gap-2">
                <Sparkles className="w-4 h-4" /> Generate narrative
              </Button>
            )}
          </div>
        </section>

        {/* ═══ MODULE 3: PROFILE — full width, clean rows ═══ */}
        <section className="bg-card border border-border rounded-2xl p-5">
          <ProfileSectionHeader icon={User} title="Profile" />
          <div className="space-y-px">
            <ProfileRow label="Real Name" value={user?.full_name} />
            {settings.fictional_world_name && <ProfileRow label="World Name" value={settings.fictional_world_name} />}
            {settings.user_birthday && <ProfileRow label="Birthday" value={settings.user_birthday} />}
            {settings.user_gender && <ProfileRow label="Gender" value={settings.user_gender} capitalize />}
            {settings.user_culture && <ProfileRow label="Culture" value={settings.user_culture} />}
            {settings.user_race && <ProfileRow label="Race" value={settings.user_race} />}
            {settings.user_aliases?.length > 0 && <ProfileRow label="Aliases" value={settings.user_aliases.join(", ")} />}
          </div>
          {settings.user_schedule_notes && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Schedule Notes</p>
              <p className="text-xs text-foreground leading-relaxed">{settings.user_schedule_notes}</p>
            </div>
          )}
          <Link to="/settings" className="block mt-4">
            <button className="w-full py-2.5 rounded-xl border border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors font-medium">
              Edit in Settings →
            </button>
          </Link>
        </section>

        {/* ═══ MODULE 4: BUSINESSES & LOCATIONS — horizontal gallery ═══ */}
        <section className="bg-card border border-border rounded-2xl p-5">
          <ProfileSectionHeader icon={Briefcase} title="Businesses & Locations" subtitle={`${ownedLocations.length + 1} owned`} />
          <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
            {/* VGC Mobile card */}
            <div className="flex-shrink-0 w-40 bg-secondary/40 border border-primary/20 rounded-xl overflow-hidden">
              <div className="h-24 bg-gradient-to-br from-primary/20 to-accent/10 flex items-center justify-center text-4xl">
                📱
              </div>
              <div className="p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-sm font-semibold text-foreground truncate">VGC Mobile</p>
                </div>
                <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-bold uppercase mb-2">Owner</span>
                <p className="text-[10px] text-muted-foreground">Phone company</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Monthly billing</p>
              </div>
            </div>
            {ownedLocations.map(loc => (
              <div key={loc.id} className="flex-shrink-0 w-40 bg-secondary/40 border border-border/60 rounded-xl overflow-hidden hover:border-primary/20 transition-colors">
                <div className="h-24 bg-gradient-to-br from-primary/15 to-accent/5 overflow-hidden">
                  {loc.image_urls?.[0] ? (
                    <img src={loc.image_urls[0]} alt={loc.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <MapPin className="w-8 h-8 text-primary/40" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-sm font-semibold text-foreground truncate">{loc.name}</p>
                  </div>
                  <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-bold uppercase mb-2">Owner</span>
                  <p className="text-[10px] text-muted-foreground capitalize">{loc.category || loc.location_type}</p>
                  {loc.owner_role && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{loc.owner_role}</p>}
                  {!loc.image_urls?.[0] && (
                    <div className="mt-2">
                      <LocationImageUploader locationId={loc.id} ownerUserId={user?.id} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            {ownedLocations.length === 0 && (
              <p className="text-xs text-muted-foreground py-4">No additional locations owned.</p>
            )}
          </div>
        </section>

        {/* ═══ MODULE 5+6: REVENUE DASHBOARD + CHARACTER BALANCES ═══ */}
        <ProfileAnalytics userSettings={settings} />

        {/* ═══ MODULE 7: HOME + CLOSET — two columns ═══ */}
        <section className="grid grid-cols-2 gap-3">
          {/* LEFT: Where You Live */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="p-4 pb-2">
              <ProfileSectionHeader icon={Home} title="Where You Live" />
            </div>
            {homeLocation ? (
              <>
                <div className="h-28 bg-gradient-to-br from-primary/15 to-accent/5 overflow-hidden mx-4 rounded-xl">
                  {homeLocation.image_urls?.[0] ? (
                    <img src={homeLocation.image_urls[0]} alt={homeLocation.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Home className="w-8 h-8 text-primary/40" />
                    </div>
                  )}
                </div>
                <div className="p-4 pt-2">
                  <p className="text-sm font-semibold text-foreground truncate">{homeLocation.name}</p>
                  <p className="text-[10px] text-muted-foreground capitalize mt-0.5">{homeLocation.category || homeLocation.location_type}</p>
                </div>
              </>
            ) : residentLocations.length > 0 ? (
              <>
                <div className="h-28 bg-gradient-to-br from-primary/15 to-accent/5 overflow-hidden mx-4 rounded-xl">
                  {residentLocations[0].image_urls?.[0] ? (
                    <img src={residentLocations[0].image_urls[0]} alt={residentLocations[0].name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Home className="w-8 h-8 text-primary/40" />
                    </div>
                  )}
                </div>
                <div className="p-4 pt-2">
                  <p className="text-sm font-semibold text-foreground truncate">{residentLocations[0].name}</p>
                  <p className="text-[10px] text-muted-foreground capitalize mt-0.5">{residentLocations[0].category || residentLocations[0].location_type}</p>
                  {residentLocations.length > 1 && (
                    <p className="text-[10px] text-muted-foreground/60 mt-1">+{residentLocations.length - 1} more</p>
                  )}
                </div>
              </>
            ) : (
              <div className="px-4 pb-4">
                <p className="text-xs text-muted-foreground italic">No residence assigned.</p>
              </div>
            )}
          </div>

          {/* RIGHT: Your Closet — compact summary */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="p-4 pb-2">
              <ProfileSectionHeader icon={Shirt} title="Your Closet" />
            </div>
            <div className="px-4 pb-4 space-y-3">
              {/* Rotation toggle (compact, read-only display) */}
              <div className="flex items-center gap-2 text-[10px]">
                <span className={`px-2 py-0.5 rounded-full font-medium ${settings.user_outfit_rotation_enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {settings.user_outfit_rotation_enabled ? "Rotation On" : "Manual"}
                </span>
              </div>
              {/* Current outfit preview */}
              {activeOutfit ? (
                <div className="flex gap-2 items-start">
                  {activeOutfit.image_url && (
                    <img src={activeOutfit.image_url} alt={activeOutfit.label} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[10px] text-primary font-semibold uppercase">Currently Wearing</p>
                    <p className="text-xs font-medium text-foreground truncate">{activeOutfit.label}</p>
                    {activeOutfit.top && <p className="text-[10px] text-muted-foreground truncate">{activeOutfit.top}</p>}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic">No outfit selected.</p>
              )}
              <button
                onClick={() => setShowClosetEditor(v => !v)}
                className="w-full py-2 rounded-lg border border-border text-[10px] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors font-medium"
              >
                {showClosetEditor ? "Hide" : "Manage"} Closet
              </button>
            </div>
          </div>
        </section>

        {/* Full closet editor — collapsible */}
        {showClosetEditor && (
          <UserClosetPanel
            settings={settings}
            onUpdate={updateSettings}
            displayName={displayName}
            gender={settings.user_gender}
          />
        )}

        {/* ═══ MODULE 8: APPEARANCE + CHARACTERS — two columns ═══ */}
        <section className="grid grid-cols-2 gap-3">
          {/* LEFT: Appearance Lock — compact categories */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="p-4 pb-2">
              <ProfileSectionHeader icon={Palette} title="Appearance" />
            </div>
            <div className="px-4 pb-4 space-y-2">
              {appearanceTraits.length > 0 ? (
                appearanceTraits.map(trait => (
                  <div key={trait.label} className="bg-secondary/30 rounded-lg px-2.5 py-1.5">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{trait.label}</p>
                    <p className="text-xs text-foreground font-medium truncate">{trait.value}</p>
                  </div>
                ))
              ) : (
                <p className="text-[10px] text-muted-foreground italic">No appearance locked.</p>
              )}
              <button
                onClick={() => setShowAppearanceEditor(v => !v)}
                className="w-full py-2 rounded-lg border border-border text-[10px] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors font-medium mt-1"
              >
                {showAppearanceEditor ? "Hide" : "Edit"} Appearance
              </button>
            </div>
          </div>

          {/* RIGHT: Characters — horizontal avatar row */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="p-4 pb-2">
              <ProfileSectionHeader icon={Users} title="Characters" subtitle={`${characters.length}`} />
            </div>
            <div className="px-4 pb-4">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
                {characters.slice(0, 8).map(char => (
                  <Link key={char.id} to={`/profile/${char.id}`} className="flex-shrink-0 flex flex-col items-center gap-1 w-14">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary/20 to-accent/10 ring-1 ring-primary/20 flex items-center justify-center overflow-hidden">
                      {char.avatar_url ? (
                        <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-primary">{char.name?.[0]}</span>
                      )}
                    </div>
                    <p className="text-[9px] text-foreground font-medium text-center truncate w-full">{char.name?.split(" ")[0]}</p>
                  </Link>
                ))}
              </div>
              <button
                onClick={() => setShowCharacterManager(v => !v)}
                className="w-full py-2 mt-2 rounded-lg border border-border text-[10px] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors font-medium"
              >
                {showCharacterManager ? "Hide" : "Manage"} Relationships
              </button>
            </div>
          </div>
        </section>

        {/* Full appearance editor — collapsible */}
        {showAppearanceEditor && (
          <UserAppearanceLockEditor settings={settings} user={user} />
        )}

        {/* Full character relationship manager — collapsible */}
        {showCharacterManager && characters.length > 0 && (
          <section className="bg-card border border-border rounded-2xl p-5">
            <ProfileSectionHeader icon={Users} title="Characters in Your World" subtitle={`${characters.length} active · Assign your relationship`} />
            <div className="space-y-1">
              {characters.map(char => {
                const currentRelative = relativeRelationships[char.id];
                const reciprocal = currentRelative ? getReciprocalRole(currentRelative, userGender) : null;
                const hasKey = (settings.home_key_holders || []).some(k => k.character_id === char.id);
                return (
                  <div key={char.id} className="py-3 border-b border-border/60 last:border-b-0">
                    <Link to={`/profile/${char.id}`}>
                      <div className="flex items-center gap-3 hover:opacity-80 transition-opacity mb-2">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/10 ring-1 ring-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {char.avatar_url ? (
                            <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-sm font-bold text-primary">{char.name?.[0]}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{char.name}</p>
                          {char.archetype && <p className="text-[10px] text-muted-foreground truncate">{char.archetype}</p>}
                        </div>
                        {hasKey && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30">
                            <Key className="w-3 h-3 text-amber-400" />
                            <span className="text-[9px] text-amber-400 font-bold uppercase">Key</span>
                          </div>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                      </div>
                    </Link>
                    <UserCharacterRelationshipSelector
                      character={char}
                      currentValue={currentRelative}
                      onSave={(rel) => handleAssignRelative(char.id, rel)}
                      onRemove={() => handleAssignRelative(char.id, null)}
                    />
                    {currentRelative && reciprocal && (
                      <p className="ml-12 mt-1.5 text-[10px] text-muted-foreground">
                        {char.name} sees you as: <span className="text-foreground font-medium capitalize">{getRelationshipLabel(reciprocal)}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <BottomNav />

      {/* ── TRANSFER VGC REVENUE MODAL ── */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4" onClick={() => setShowTransferModal(false)}>
          <div className="w-full max-w-sm bg-card border border-border rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Send className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Transfer from VGC Revenue</h3>
                <p className="text-xs text-muted-foreground">Move phone bill revenue to personal balance</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Available: <span className="text-foreground font-medium">${fmtMoney(vgcRevenue)}</span></p>
              <input
                type="number"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="Amount to transfer"
                max={vgcRevenue}
                min="0"
                step="0.01"
                className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => { setShowTransferModal(false); setTransferAmount(""); }}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const amount = parseFloat(transferAmount);
                  if (amount > 0 && amount <= vgcRevenue) {
                    setIsTransferring(true);
                    try {
                      await updateSettings({
                        user_balance: (settings.user_balance || 0) + amount,
                        vgc_mobile_revenue: Math.max(0, vgcRevenue - amount),
                      });
                      setShowTransferModal(false);
                      setTransferAmount("");
                      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
                    } catch (err) {
                      console.error('Transfer failed:', err);
                    } finally {
                      setIsTransferring(false);
                    }
                  }
                }}
                disabled={!transferAmount || parseFloat(transferAmount) <= 0 || parseFloat(transferAmount) > vgcRevenue || isTransferring}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isTransferring ? "Transferring..." : "Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileRow({ label, value, capitalize }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs text-foreground font-medium ${capitalize ? "capitalize" : ""}`}>
        {value}
      </span>
    </div>
  );
}