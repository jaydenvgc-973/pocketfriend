import React, { useState, useEffect } from "react";
import { useUserSettings } from "@/hooks/useUserSettings";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Sparkles, RefreshCw, DollarSign, Key, MapPin, Briefcase,
  Home, Phone, Send, User, Eye, Wallet, Shirt, Palette, Users, ChevronRight,
} from "lucide-react";
import VGCRevenueDashboard from "@/components/finance/VGCRevenueDashboard";
import { Button } from "@/components/ui/button";
import UserAppearanceLockEditor from "@/components/user/UserAppearanceLockEditor";
import UserClosetPanel from "@/components/user/UserClosetPanel";
import UserCharacterRelationshipSelector from "@/components/user/UserCharacterRelationshipSelector";
import BottomNav from "@/components/BottomNav";
import ProfileSectionHeader from "@/components/profile/ProfileSectionHeader";
import { getReciprocalRole, getRelationshipLabel, isFamilyRelationship } from "@/lib/relationshipUtils.js";

export default function MyProfile() {
  const queryClient = useQueryClient();
  const [narrative, setNarrative] = useState("");
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false);
  const [relativeRelationships, setRelativeRelationships] = useState({});
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);

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

  const displayName = settings.fictional_world_name || user?.full_name || "You";
  const avatarUrl = user?.generated_avatar_urls?.[0] || user?.reference_image_urls?.[0] || null;
  const balance = settings.user_balance ?? 6000;
  const vgcRevenue = settings.vgc_mobile_revenue ?? 0;
  const userGender = settings.user_gender || "other";

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

    const oldRelationship = updated[charId];

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

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* ── STICKY HEADER ── */}
      <div className="sticky top-0 z-30 bg-gradient-to-b from-background via-background/95 to-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-base font-bold text-foreground flex-1">Your Information</h1>
        <Link to="/settings" className="text-xs text-muted-foreground hover:text-primary transition-colors font-medium">
          Settings
        </Link>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-8">

        {/* ═══ MODULE 1: HERO + FINANCIAL SUMMARY ═══ */}
        <section className="space-y-5">
          {/* Hero profile */}
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/40 to-accent/20 blur-xl scale-110" />
              <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 to-accent/10 ring-2 ring-primary/30 flex items-center justify-center overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold text-primary">
                    {displayName?.[0]?.toUpperCase() || "?"}
                  </span>
                )}
              </div>
            </div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-foreground">{displayName}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{user?.email}</p>
            </div>
          </div>

          {/* Financial summary cards */}
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

        {/* ═══ MODULE 2: HOW THE WORLD SEES YOU ═══ */}
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
        </section>

        {/* ═══ MODULE 3: PROFILE INFORMATION ═══ */}
        <section className="bg-card border border-border rounded-2xl p-5">
          <ProfileSectionHeader icon={User} title="Profile" />
          <div className="space-y-px">
            <ProfileRow label="Real Name" value={user?.full_name} />
            {settings.fictional_world_name && (
              <ProfileRow label="World Name" value={settings.fictional_world_name} />
            )}
            {settings.user_birthday && (
              <ProfileRow label="Birthday" value={settings.user_birthday} />
            )}
            {settings.user_gender && (
              <ProfileRow label="Gender" value={settings.user_gender} capitalize />
            )}
            {settings.user_aliases?.length > 0 && (
              <ProfileRow label="Aliases" value={settings.user_aliases.join(", ")} />
            )}
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

        {/* ═══ MODULE 4: BUSINESSES & LOCATIONS ═══ */}
        <section className="bg-card border border-border rounded-2xl p-5">
          <ProfileSectionHeader
            icon={Briefcase}
            title="Businesses & Locations"
            subtitle={`${ownedLocations.length + 1} owned`}
          />
          <div className="space-y-2.5">
            {/* VGC Mobile — always listed */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-lg">
                📱
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-foreground font-semibold">VGC Mobile</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-bold uppercase tracking-wider">Owner</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Phone company</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Characters pay monthly bills — revenue goes to you</p>
              </div>
            </div>
            {ownedLocations.map(loc => (
              <div key={loc.id} className="flex items-start gap-3 p-3 rounded-xl bg-secondary/40 border border-border/60 hover:border-primary/20 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-foreground font-medium truncate">{loc.name}</p>
                    {loc.image_urls?.[0] && (
                      <img src={loc.image_urls[0]} alt="" className="w-4 h-4 rounded object-cover flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">{loc.category || loc.location_type}</p>
                  {loc.owner_role && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{loc.owner_role}</p>}
                </div>
              </div>
            ))}
            {ownedLocations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">No additional locations owned.</p>
            )}
          </div>
        </section>

        {/* ═══ MODULE 5: REVENUE DASHBOARD ═══ */}
        <section className="bg-card border border-border rounded-2xl p-5">
          <ProfileSectionHeader icon={DollarSign} title="Revenue Dashboard" />
          <VGCRevenueDashboard userSettings={settings} />
        </section>

        {/* ═══ MODULE 6: WHERE YOU LIVE ═══ */}
        {residentLocations.length > 0 && (
          <section className="bg-card border border-border rounded-2xl p-5">
            <ProfileSectionHeader icon={Home} title="Where You Live" />
            <div className="space-y-2.5">
              {residentLocations.map(loc => (
                <div key={loc.id} className="flex items-start gap-3 p-3 rounded-xl bg-secondary/40 border border-border/60">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {loc.image_urls?.[0] ? (
                      <img src={loc.image_urls[0]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Home className="w-4 h-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-medium">{loc.name}</p>
                    <p className="text-xs text-muted-foreground capitalize mt-0.5">{loc.category || loc.location_type}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ═══ MODULE 7: CLOSET ═══ */}
        <section className="space-y-3">
          <ProfileSectionHeader icon={Shirt} title="Closet" subtitle="Outfits & rotation" />
          <UserClosetPanel
            settings={settings}
            onUpdate={updateSettings}
            displayName={displayName}
            gender={settings.user_gender}
          />
        </section>

        {/* ═══ MODULE 8: APPEARANCE LOCK ═══ */}
        <section className="space-y-3">
          <ProfileSectionHeader icon={Palette} title="Appearance" subtitle="Visual identity settings" />
          <UserAppearanceLockEditor settings={settings} user={user} />
        </section>

        {/* ═══ MODULE 9: CHARACTER MANAGEMENT ═══ */}
        {characters.length > 0 && (
          <section className="bg-card border border-border rounded-2xl p-5">
            <ProfileSectionHeader
              icon={Users}
              title="Characters in Your World"
              subtitle={`${characters.length} active · Assign your relationship`}
            />
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
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30" title={`${char.name} gave you a key to their home`}>
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

/** Clean two-column label/value row used inside the Profile section */
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