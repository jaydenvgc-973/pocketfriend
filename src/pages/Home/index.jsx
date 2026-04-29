import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Users, Settings, Wrench } from "lucide-react";
import FixLocationsButton from "@/components/home/FixLocationsButton";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import CharacterCard from "@/components/home/CharacterCard";
import UserCard from "@/components/home/UserCard";
import DeleteCharacterDialog from "@/components/home/DeleteCharacterDialog";
import CharacterInteractionSimulator from "@/components/home/CharacterInteractionSimulator";
import BottomNav from "@/components/BottomNav";
import DailyAchievementReminder from "@/components/home/DailyAchievementReminder";
import TroubleshootingPanelHome from "@/components/home/TroubleshootingPanelHome";
import ThomasAndersonFix from "@/components/home/ThomasAndersonFix";
import InviteOutModal from "@/components/home/InviteOutModal";
import NPCContactPanel from "@/components/home/NPCContactPanel";
import { DEFAULT_CHARACTER_DATA, buildSystemPrompt } from "@/lib/defaultCharacter";
import { getCharactersForHomepage } from "@/lib/characterEditableListResolver";

export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [invitations, setInvitations] = useState(null);

  const { settings: userSettings } = useUserSettings();
  // Keep settings as array-compatible for legacy references (onClose invite modal)
  const settings = userSettings?.id ? [userSettings] : [];

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [], isLoading } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      // Query by owner_email ONLY — sole ownership authority
      const characters = await base44.entities.Character.filter({ owner_email: currentUser.email }, "-created_date");
      // EXCLUDE diagnostic/test characters from homepage
      return characters.filter(c => {
        if (c.is_test_character === true) return false;
        if (c.diagnostic_only === true) return false;
        if (c.exclude_from_homepage === true) return false;
        return true;
      });
    },
    enabled: !!currentUser?.email,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Fetch locations with zero cache to prevent stale empty data
  const { data: locationsData = [], isLoading: isLocationsLoading } = useQuery({
    queryKey: ["locationReferences", currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email,
    staleTime: 30000,
    gcTime: 60000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
  });

  // Real-time: invalidate locations when any LocationReference changes
  useEffect(() => {
    const unsubscribe = base44.entities.LocationReference.subscribe((event) => {
      if (event.type === "create" || event.type === "update" || event.type === "delete") {
        queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
      }
    });
    return () => unsubscribe();
  }, [currentUser?.email, queryClient]);

  // Build location map — ready when loading completes, regardless of whether result is empty.
  // CRITICAL FIX: never gate on locationsData.length > 0 — an account with zero locations
  // is a valid state and must still render the homepage. Gating on length causes infinite spinner.
  const isLocationMapReady = !isLocationsLoading;
  const locationMap = isLocationMapReady ? Object.fromEntries((locationsData || []).map(l => [l.id, l])) : {};



  // Check for character invites on first mount only
  useEffect(() => {
    if (!currentUser?.email) return;
    const hasCheckedThisSession = sessionStorage.getItem(`invites_checked_${currentUser.email}`);
    if (hasCheckedThisSession) return;

    sessionStorage.setItem(`invites_checked_${currentUser.email}`, 'true');
    base44.functions.invoke('checkAndTriggerInvites', {})
      .then(res => {
        if (res.data?.shouldShow && res.data?.invitations?.length > 0) {
          setInvitations(res.data.invitations);
        }
      })
      .catch(() => {});
  }, [currentUser?.email]);

  // Real-time: immediately reflect any character create/update/delete
  useEffect(() => {
    if (!currentUser?.email) return;
    const unsubscribe = base44.entities.Character.subscribe((event) => {
      if (event.type === "create" || event.type === "update" || event.type === "delete") {
        queryClient.invalidateQueries({ queryKey: ["characters", currentUser.email] });
      }
    });
    return () => unsubscribe();
  }, [currentUser?.email, queryClient]);

  const deleteMutation = useMutation({
    mutationFn: async ({ id, cause, closeness }) => {
      const activeOthers = characters.filter(c => c.id !== id && c.status !== "deleted");
      const departed = characters.find(c => c.id === id);
      if (departed) {
        await Promise.all(activeOthers.map(c =>
          base44.entities.Character.update(c.id, {
            departed_characters: [
              ...(c.departed_characters || []),
              { name: departed.name, cause, relationship_closeness: closeness }
            ]
          })
        ));
      }
      return base44.entities.Character.delete(id);
    },
    onSuccess: () => {
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    },
  });

  const moveAwayMutation = useMutation({
    mutationFn: async (id) => {
      const activeOthers = characters.filter(c => c.id !== id && c.status !== "deleted" && c.status !== "moved_away");
      const mover = characters.find(c => c.id === id);
      if (mover) {
        await Promise.all(activeOthers.map(c =>
          base44.entities.Character.update(c.id, {
            departed_characters: [
              ...(c.departed_characters || []),
              { name: mover.name, cause: "moved_away", relationship_closeness: "acquaintance" }
            ]
          })
        ));
      }
      return base44.entities.Character.update(id, { status: "moved_away" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }),
  });

  const moveBackMutation = useMutation({
    mutationFn: async (id) => {
      return base44.entities.Character.update(id, { status: "active" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }),
  });

  useEffect(() => {
    const defaultChar = characters.find(c => c.is_default);
    if (!defaultChar) return;
    if (defaultChar.family_history && defaultChar.system_prompt_url) return;
    const updated = {
      ...DEFAULT_CHARACTER_DATA,
      name: defaultChar.name,
      avatar_url: defaultChar.avatar_url || undefined,
      reference_image_urls: defaultChar.reference_image_urls || undefined,
      emotional_state: defaultChar.emotional_state || "calm",
    };
    const promptText = buildSystemPrompt(updated);
    base44.integrations.Core.UploadFile({
      file: new File([promptText], "system_prompt.txt", { type: "text/plain" })
    }).then(({ file_url }) => {
      return base44.entities.Character.update(defaultChar.id, { ...updated, system_prompt_url: file_url });
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    }).catch(() => {});
  }, [characters, currentUser?.email]);

  useEffect(() => {
    if (!isLoading && !currentUser?.email) {
      navigate("/");
    }
  }, [isLoading, currentUser?.email, navigate]);

  const defaultChar = characters.find(c => c.is_default);
  const customChars = characters.filter(c => !c.is_default && c.status !== "deleted");
  
  // Use unified resolver to get homepage-eligible characters
  const { activeCharacters } = getCharactersForHomepage(customChars, currentUser?.id, currentUser?.email);
  
  // Sort remaining active created characters alphabetically
  // STRICT TYPE GUARD: only active_created_character may appear as character cards on the homepage
  const activeCustomChars = activeCharacters
    .filter(c => (c.status === "active" || !c.status) && c.name !== "Leo Parker" && c.character_type === "active_created_character")
    .sort((a, b) => {
      const nameA = (a.display_name || a.name || '').toLowerCase();
      const nameB = (b.display_name || b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  const movedAwayChars = customChars.filter(c => c.status === "moved_away");
  const canCreate = true;
  const canMoveBack = movedAwayChars.length > 0;
  const showPerformanceWarning = activeCustomChars.length >= 7;
  const thomasAnderson = characters.find(c => c.name === 'Thomas Anderson' || c.name === 'Thomas');
  const thomasInDisplay = activeCustomChars.some(c => c.id === thomasAnderson?.id);
  const showThomasAndersonFix = thomasAnderson && !thomasInDisplay;

  return (
    <div className="min-h-screen bg-background">
      <AnimatePresence>
        {pendingDelete && (
          <DeleteCharacterDialog
            character={pendingDelete}
            onConfirm={({ cause, closeness }) => deleteMutation.mutate({ id: pendingDelete.id, cause, closeness })}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </AnimatePresence>
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border px-6 py-4">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold text-foreground">Pocketfriend</h1>
            <div className="flex items-center gap-2">
              <Link to="/groups">
                <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:text-foreground">
                  <Users className="w-5 h-5" />
                </Button>
              </Link>
              <FixLocationsButton currentUserEmail={currentUser?.email} />
              <button
                onClick={() => setShowTroubleshooting(true)}
                className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Troubleshoot Home page"
              >
                <Wrench className="w-4 h-4" />
              </button>
              <Link to="/settings">
                <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:text-foreground">
                  <Settings className="w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {!isLocationMapReady && (
        <div className="max-w-lg mx-auto px-6 py-6 flex items-center justify-center min-h-[200px]">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
        </div>
      )}

      {isLocationMapReady && (
        <div className="max-w-lg mx-auto px-6 py-6 pb-32 space-y-6">
          {showThomasAndersonFix && (
            <ThomasAndersonFix onSuccess={() => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] })} />
          )}
          {currentUser && (
            <UserCard user={currentUser} settings={userSettings || {}} />
          )}
          {defaultChar && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Your character</p>
              <CharacterCard character={defaultChar} locationMap={locationMap} locationData={{}} />
            </div>
          )}
          {(defaultChar && activeCustomChars.length >= 1) || activeCustomChars.length >= 2 ? (
            <CharacterInteractionSimulator characters={[
              ...(defaultChar ? [defaultChar] : []),
              ...activeCustomChars,
              ...characters.filter(c => c.character_type === 'npc_fictitious' && c.status === 'active' && !c.is_test_character && !c.diagnostic_only),
            ]} />
          ) : null}
          
          <div>
            {showPerformanceWarning && (
              <div className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <p className="text-xs font-medium text-amber-600 mb-1">⚠️ Performance Notice</p>
                <p className="text-xs text-amber-600/80">You have {activeCustomChars.length} custom characters. The app may slow down with many active characters. Performance depends on your device.</p>
              </div>
            )}
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Custom characters ({activeCustomChars.length})</p>
              {canCreate && (
                <Link to="/create">
                  <motion.button whileTap={{ scale: 0.95 }} className="flex items-center gap-1.5 text-xs text-primary font-medium">
                    <Plus className="w-3.5 h-3.5" /> Create
                  </motion.button>
                </Link>
              )}
            </div>
            {activeCustomChars.length === 0 && movedAwayChars.length === 0 ? (
              <Link to="/create">
                <motion.div whileTap={{ scale: 0.98 }} className="border-2 border-dashed border-border rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary/30 transition-colors">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Plus className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-sm font-medium text-foreground">Create a character</p>
                  <p className="text-xs text-muted-foreground mt-1">Build someone with their own story</p>
                </motion.div>
              </Link>
            ) : (
              <div className="grid gap-3">
                {activeCustomChars.map(c => (
                  <CharacterCard key={c.id} character={c}
                    onDelete={(id) => setPendingDelete(characters.find(ch => ch.id === id))}
                    onMoveAway={(id) => moveAwayMutation.mutate(id)}
                    locationMap={locationMap}
                    locationData={{}}
                  />
                ))}
                {movedAwayChars.map(c => (
                  <CharacterCard key={c.id} character={c} onMoveAway={() => moveBackMutation.mutate(c.id)} locationMap={locationMap} locationData={{}} />
                ))}
                <Link to="/create">
                  <motion.div whileTap={{ scale: 0.98 }} className="border-2 border-dashed border-border rounded-2xl p-6 flex items-center justify-center cursor-pointer hover:border-primary/30 transition-colors">
                    <Plus className="w-4 h-4 text-muted-foreground mr-2" />
                    <span className="text-sm text-muted-foreground">Add another</span>
                  </motion.div>
                </Link>
                <div className="mt-2">
                  <NPCContactPanel />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <DailyAchievementReminder />
      <TroubleshootingPanelHome
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
      />
      {invitations && (
        <InviteOutModal
          invitations={invitations}
          onAccept={(invite) => {
            base44.functions.invoke('recordCharacterInviteAccepted', {
              characterId: invite.characterId,
              locationId: invite.locationId,
              inviteType: invite.inviteType,
            }).catch(() => {});

            const remaining = invitations.filter(i => i.characterId !== invite.characterId);
            setInvitations(remaining.length > 0 ? remaining : null);
            
            const charIds = invite.characterIds ? invite.characterIds.join(",") : invite.characterId;
            navigate(`/scene?locationId=${invite.locationId}&characterIds=${charIds}`);
          }}
          onMaybeLater={(inv) => {
            // Character goes anyway — user just isn't joining
            base44.functions.invoke('recordCharacterInviteDeclined', {
              characterId: inv.characterId,
              locationId: inv.locationId,
            }).catch(() => {});
            const remaining = invitations.filter(i => i.characterId !== inv.characterId);
            setInvitations(remaining.length > 0 ? remaining : null);
          }}
          onSuggestAlternative={(inv) => {
            const remaining = invitations.filter(i => i.characterId !== inv.characterId);
            setInvitations(remaining.length > 0 ? remaining : null);
          }}
          onDecline={(inv) => {
            // Character still goes — user declined the invite but the character had their own plan
            base44.functions.invoke('recordCharacterInviteDeclined', {
              characterId: inv.characterId,
              locationId: inv.locationId,
            }).catch(() => {});
            const remaining = invitations.filter(i => i.characterId !== inv.characterId);
            setInvitations(remaining.length > 0 ? remaining : null);
          }}
          onClose={() => {
            if (settings[0]?.id) {
              base44.entities.UserSettings.update(settings[0].id, {
                pending_character_invites: [],
              }).catch(() => {});
            }
            setInvitations(null);
          }}
        />
      )}
      <BottomNav />
    </div>
  );
}