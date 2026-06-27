import React, { useEffect, useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Users, Settings, Wrench, RefreshCw } from "lucide-react";
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
import IncarcerationReleaseModal from "@/components/home/IncarcerationReleaseModal";
import GraduationEventModal from "@/components/home/GraduationEventModal";

import InviteOutModal from "@/components/home/InviteOutModal";
import NPCContactPanel from "@/components/home/NPCContactPanel";
import VickServiceCard from "@/components/home/VickServiceCard";
import CommunityEventsStrip from "@/components/home/CommunityEventsStrip.jsx";
import { getCharactersForHomepage } from "@/lib/characterEditableListResolver";
import { useOwnedCharacters } from "@/hooks/useOwnedCharacters";
import { usePageContext } from "@/hooks/usePageContext";
import { lfcRead, lfcWrite } from "@/lib/localFirstCache.js";
import { useStableLocationReferences } from "@/hooks/useStableLocationReferences";
import { useTravelSessions, applySessionProofToCharacters } from "@/lib/travelDisplayIntegrity";
import { useHomeConversations } from "@/hooks/useHomeConversations";
import { useHomeUnreadCounts } from "@/hooks/useHomeUnreadCounts";

export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [invitations, setInvitations] = useState(null);
  const [pendingReleases, setPendingReleases] = useState([]);
  const [graduationEvents, setGraduationEvents] = useState([]);

  // Resolve user FIRST — useUserSettings receives the email override to eliminate
  // the cold-cache waterfall where settings wait for a second user query resolution.
  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Pass currentUser?.email so useUserSettings can load settings in parallel with
  // the user query, not sequentially after it. On warm cache this is a no-op.
  // On cold cache this eliminates the blank balance delay.
  const { settings: userSettings, isLoading: isSettingsLoading, isError: isSettingsError } = useUserSettings(currentUser?.email || null);
  // Keep settings as array-compatible for legacy references (onClose invite modal)
  const settings = userSettings?.id ? [userSettings] : [];

  // home_anchor_character_ids: stable IDs of continuity anchor characters (e.g. Ethan, Melody).
  // CRITICAL: Only pass anchors AFTER settings has finished loading.
  // Passing [] while settings is still loading causes the bootstrap guard to run its
  // first recovery pass without anchor knowledge, self-lock recoveryFiredRef, and then
  // ignore anchors permanently even after settings loads with real IDs.
  const anchorCharacterIds = (!isSettingsLoading && userSettings?.home_anchor_character_ids?.length)
    ? userSettings.home_anchor_character_ids
    : [];

  const {
    allCharacters,
    rlsCharacters: characters,
    isInitialLoading,
    isInitialLoading: isLoading,
    isRefreshing,
    isFinancialLoading,
    financialIndex,
  } = useOwnedCharacters(currentUser, userSettings?.default_character_id || null, anchorCharacterIds);

  // Shared stable location hook — deletion-safe LKG, single source of truth
  const { locationsData, isLoading: isLocationsLoading, isError: isLocationsError } = useStableLocationReferences(currentUser?.email);

  // Real-time: invalidate locations when a LocationReference is created or deleted.
  // IMPORTANT: automations write Character records, not LocationReference records — so
  // this subscriber fires only when the user explicitly adds/removes a location.
  // UPDATE events are intentionally excluded: name/zone edits don't affect the dropdown list.
  // DEBOUNCE: 5 minutes — location structure changes are infrequent user actions.
  // This prevents automation-triggered LocationReference writes (e.g. temporary housing
  // creation) from firing a fetchAllLocationsForUser call on every automation tick.
  const locationInvalidateTimerRef = useRef(null);
  useEffect(() => {
    const unsubscribe = base44.entities.LocationReference.subscribe((event) => {
      // Only react to structural changes (create/delete), not field updates
      if (event.type !== "create" && event.type !== "delete") return;
      if (locationInvalidateTimerRef.current) return; // already scheduled — skip
      locationInvalidateTimerRef.current = setTimeout(() => {
        locationInvalidateTimerRef.current = null;
        queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
      }, 5 * 60 * 1000); // 5 min debounce — structural location changes are rare user actions
    });
    return () => {
      unsubscribe();
      if (locationInvalidateTimerRef.current) {
        clearTimeout(locationInvalidateTimerRef.current);
        locationInvalidateTimerRef.current = null;
      }
    };
  }, [currentUser?.email, queryClient]);

  // Build location map — ready when loading completes, regardless of whether result is empty.
  // CRITICAL FIX: never gate on locationsData.length > 0 — an account with zero locations
  // is a valid state and must still render the homepage. Gating on length causes infinite spinner.
  const isLocationMapReady = !isLocationsLoading;
  const locationMap = isLocationMapReady ? Object.fromEntries((locationsData || []).map(l => [l.id, l])) : {};



  // PRIORITY ARCHITECTURE: completeStuckTravelUserScoped, checkAndTriggerInvites,
  // and checkLifecycleEvents are NOT startup requirements. They are maintenance,
  // repair, and enrichment tasks that do not belong in Home startup.
  // They have been removed from this mount sequence per the priority correction plan.
  // - completeStuckTravelUserScoped → Priority 6: triggered by Travel page or scheduled automation
  // - checkAndTriggerInvites → Priority 7: idle processing, triggered after user is settled
  // - checkLifecycleEvents → Priority 6: server-side automation owns this, not the client

  // Real-time character cache sync has been moved into useOwnedCharacters.js.
  // It is now active on every page that mounts the hook (Home, Travel, Map),
  // not only when Home is mounted. No duplicate subscription here.

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
    onSuccess: (_, { id }) => {
      setPendingDelete(null);
      // Surgical cache remove — avoids full 300-record re-fetch just for a delete
      queryClient.setQueryData(["characters", currentUser?.email], (prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.filter(c => c.id !== id);
      });
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
    onSuccess: (_, id) => {
      // Surgical cache patch — mark moved_away without re-fetching
      queryClient.setQueryData(["characters", currentUser?.email], (prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map(c => c.id === id ? { ...c, status: "moved_away" } : c);
      });
    },
  });

  const moveBackMutation = useMutation({
    mutationFn: async (id) => {
      return base44.entities.Character.update(id, { status: "active" });
    },
    onSuccess: (_, id) => {
      // Surgical cache patch — restore active without re-fetching
      queryClient.setQueryData(["characters", currentUser?.email], (prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map(c => c.id === id ? { ...c, status: "active" } : c);
      });
    },
  });

  useEffect(() => {
    if (!isLoading && !currentUser?.email) {
      navigate("/");
    }
  }, [isLoading, currentUser?.email, navigate]);

  // REFRESH / RE-SYNC: discard all stale homepage state and force authoritative re-read.
  // This is a synchronization action only — no mutations, no type changes, no repairs.
  // Rules:
  //   - character records (location, presence, needs, sleep, work, school, travel) are re-fetched from DB
  //   - location references are re-fetched
  //   - travel sessions are re-fetched
  //   - conversations + unread counts are re-fetched
  //   - old cached state is discarded before re-fetch (removeQueries), not merged with stale data
  // Cached data must never be the authority source — this forces a clean read.
  const handleRefreshSync = async () => {
    if (isSyncing || !currentUser?.email) return;
    setIsSyncing(true);
    try {
      const email = currentUser.email;
      // Remove stale caches so old location/presence/sleep/travel data cannot win over the re-fetch
      queryClient.removeQueries({ queryKey: ["characters", email] });
      queryClient.removeQueries({ queryKey: ["locationReferences", email] });
      queryClient.removeQueries({ queryKey: ["travelSessions", email] });
      queryClient.removeQueries({ queryKey: ["homeConversations", email] });
      queryClient.removeQueries({ queryKey: ["homeUnread", email] });
      // Force immediate authoritative refetch of all authority sources
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["characters", email] }),
        queryClient.refetchQueries({ queryKey: ["locationReferences", email] }),
        queryClient.refetchQueries({ queryKey: ["travelSessions", email] }),
      ]);
    } finally {
      setIsSyncing(false);
    }
  };

  // Register page context so simulationGate knows home is active (no specific character/location)
  usePageContext({ page: 'home' });

  // Load active in_transit sessions — used to gate travel display (ONE TRUTH RULE)
  const { sessions: activeTravelSessions } = useTravelSessions(currentUser?.email);

  // SHARED CONVERSATION + UNREAD LAYER
  // ONE Conversation.filter for all characters (not per-card).
  // ONE batched Message.filter pass for all conversations (not per-card).
  // CharacterCard receives its pre-computed badge counts as props — zero independent queries.
  const { allConversations: homeConversations, getConversationsForCharacter } = useHomeConversations(currentUser?.email);
  const { getUnreadForCharacter } = useHomeUnreadCounts(currentUser?.email, homeConversations);

  // Auto-sanitize stale default_character_id:
  // If UserSettings.default_character_id points to a character not in the loaded list,
  // clear it silently — once per session — so it doesn't keep triggering recovery checks.
  const staleDefaultClearedRef = useRef(false);
  useEffect(() => {
    const defaultId = userSettings?.default_character_id;
    if (!defaultId || staleDefaultClearedRef.current) return;
    if (!userSettings?.id || allCharacters.length === 0) return;
    const exists = allCharacters.some(c => c.id === defaultId);
    if (!exists) {
      staleDefaultClearedRef.current = true;
      console.log(`[Home] Stale default_character_id=${defaultId} — clearing from UserSettings`);
      base44.entities.UserSettings.update(userSettings.id, { default_character_id: null }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSettings?.default_character_id, userSettings?.id, allCharacters.length]);

  const defaultChar = allCharacters.find(c => c.is_default);
  const customChars = allCharacters.filter(c => !c.is_default && c.status !== "deleted");
  
  // Use unified resolver to get homepage-eligible characters from the full merged pool
  const { activeCharacters } = getCharactersForHomepage(customChars, currentUser?.id, currentUser?.email);
  
  // HOMEPAGE CARD ELIGIBILITY — STRICT RULE, NO FALLBACKS:
  // Standard homepage cards are generated only from records whose canonical
  // character_type is exactly "active_created_character". No other type is eligible.
  // Profile data, memories, relationships, finance records, or contact links do not
  // confer homepage eligibility. Vick uses VickServiceCard exclusively and does not
  // pass through this filter.
  const activeCustomChars = activeCharacters
    .filter(c =>
      c.character_type === "active_created_character" &&
      (c.status === "active" || !c.status) &&
      !c.exclude_from_homepage
    )
    .sort((a, b) => {
      const aAnchorIdx = anchorCharacterIds.indexOf(a.id);
      const bAnchorIdx = anchorCharacterIds.indexOf(b.id);
      // Both are anchors — sort by their declared priority order
      if (aAnchorIdx !== -1 && bAnchorIdx !== -1) return aAnchorIdx - bAnchorIdx;
      // Only a is an anchor — a comes first
      if (aAnchorIdx !== -1) return -1;
      // Only b is an anchor — b comes first
      if (bAnchorIdx !== -1) return 1;
      // Neither is an anchor — alphabetical
      const nameA = (a.display_name || a.name || '').toLowerCase();
      const nameB = (b.display_name || b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  const movedAwayChars = customChars.filter(c => c.status === "moved_away" && c.character_type === "active_created_character");
  const canCreate = true;
  const canMoveBack = movedAwayChars.length > 0;
  const showPerformanceWarning = activeCustomChars.length >= 7;

  // Apply travel display integrity — gate "Traveling to…" on valid in_transit sessions
  const verifiedActiveCustomChars = applySessionProofToCharacters(activeCustomChars, activeTravelSessions);

  // PRIORITY ARCHITECTURE: Financial integrity audit removed from Home startup.
  // This was a Priority 8 violation — diagnostics do not belong in the Home render pipeline.
  // Financial data integrity is verified at the CharacterCard level (console.error only)
  // when the data is actually needed for display, not proactively at page mount.

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
              <button
                onClick={handleRefreshSync}
                disabled={isSyncing}
                className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                title="Re-sync — discard stale cache and reload authoritative character state"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
              </button>
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

      {isInitialLoading && allCharacters.length === 0 && (
        <div className="max-w-lg mx-auto px-6 py-6 flex items-center justify-center min-h-[200px]">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
        </div>
      )}

      {(!isInitialLoading || allCharacters.length > 0) && (
        <div className="max-w-lg mx-auto px-6 py-6 pb-32 space-y-6">

          {currentUser && (
            <UserCard
              user={currentUser}
              settings={userSettings || {}}
              settingsId={userSettings?.id}
              settingsLoading={isSettingsLoading}
              settingsError={isSettingsError}
              locations={locationsData}
              isLocationsLoading={isLocationsLoading}
              isLocationsError={isLocationsError}
            />
          )}
          {defaultChar && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Your character</p>
              <CharacterCard character={defaultChar} locationMap={locationMap} locationData={{}} financialRecord={financialIndex[defaultChar.id] || null} isFinancialLoading={isFinancialLoading} unreadCounts={getUnreadForCharacter(defaultChar.id)} />
            </div>
          )}
          {(defaultChar && activeCustomChars.length >= 1) || activeCustomChars.length >= 2 ? (
            <CharacterInteractionSimulator
              currentUser={currentUser}
              userSettings={userSettings}
              characters={[
                ...(defaultChar ? [defaultChar] : []),
                ...activeCustomChars,
                ...allCharacters.filter(c =>
                  ['npc_fictitious', 'npc_family_member', 'npc_regular', 'npc_world_service'].includes(c.character_type) &&
                  c.status === 'active' &&
                  !c.is_test_character &&
                  !c.diagnostic_only
                ),
              ]}
            />
          ) : null}

          {currentUser && (
            <CommunityEventsStrip
              currentUser={currentUser}
              characters={[
                ...(defaultChar ? [defaultChar] : []),
                ...activeCustomChars,
              ]}
            />
          )}
          
          {currentUser?.email && (
            <VickServiceCard ownerEmail={currentUser.email} />
          )}

          <div>
            {showPerformanceWarning && (
              <div className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <p className="text-xs font-medium text-amber-600 mb-1">⚠️ Performance Notice</p>
                <p className="text-xs text-amber-600/80">You have {activeCustomChars.length} custom characters. The app may slow down with many active characters. Performance depends on your device.</p>
              </div>
            )}
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Custom characters ({verifiedActiveCustomChars.length})</p>
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
                {verifiedActiveCustomChars.map(c => (
                  <CharacterCard key={c.id} character={c}
                    onDelete={(id) => setPendingDelete(characters.find(ch => ch.id === id))}
                    onMoveAway={(id) => moveAwayMutation.mutate(id)}
                    locationMap={locationMap}
                    locationData={{}}
                    financialRecord={financialIndex[c.id] || null}
                    isFinancialLoading={isFinancialLoading}
                    unreadCounts={getUnreadForCharacter(c.id)}
                  />
                ))}
                {movedAwayChars.map(c => (
                  <CharacterCard key={c.id} character={c} onMoveAway={() => moveBackMutation.mutate(c.id)} locationMap={locationMap} locationData={{}} financialRecord={financialIndex[c.id] || null} isFinancialLoading={isFinancialLoading} unreadCounts={getUnreadForCharacter(c.id)} />
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

      {/* Lifecycle event popups — session-gated, idempotent */}
      {graduationEvents.length > 0 && (
        <GraduationEventModal
          events={graduationEvents}
          onDismiss={() => setGraduationEvents([])}
        />
      )}
      {pendingReleases.length > 0 && graduationEvents.length === 0 && (
        <IncarcerationReleaseModal
          releases={pendingReleases}
          onDismiss={() => setPendingReleases([])}
        />
      )}

      <TroubleshootingPanelHome
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
        ownerEmail={currentUser?.email}
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