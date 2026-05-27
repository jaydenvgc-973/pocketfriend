import React, { useEffect, useState, useRef } from "react";
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
import IncarcerationReleaseModal from "@/components/home/IncarcerationReleaseModal";
import GraduationEventModal from "@/components/home/GraduationEventModal";

import InviteOutModal from "@/components/home/InviteOutModal";
import NPCContactPanel from "@/components/home/NPCContactPanel";
import CommunityEventsStrip from "@/components/home/CommunityEventsStrip.jsx";
import { DEFAULT_CHARACTER_DATA, buildSystemPrompt } from "@/lib/defaultCharacter";
import { getCharactersForHomepage } from "@/lib/characterEditableListResolver";
import { useOwnedCharacters } from "@/hooks/useOwnedCharacters";
import { usePageContext } from "@/hooks/usePageContext";
import { lfcRead, lfcWrite } from "@/lib/localFirstCache.js";
import { useStableLocationReferences } from "@/hooks/useStableLocationReferences";
import { useTravelSessions, applySessionProofToCharacters } from "@/lib/travelDisplayIntegrity";

export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [invitations, setInvitations] = useState(null);
  const [pendingReleases, setPendingReleases] = useState([]);
  const [graduationEvents, setGraduationEvents] = useState([]);

  const { settings: userSettings, isLoading: isSettingsLoading, isError: isSettingsError } = useUserSettings();
  // Keep settings as array-compatible for legacy references (onClose invite modal)
  const settings = userSettings?.id ? [userSettings] : [];

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

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



  // AUTO-RESOLVE STUCK TRAVEL on home mount — session-gated.
  // completeStuckTravelUserScoped is the only path that can write to Character (user-scoped RLS).
  useEffect(() => {
    if (!currentUser?.email) return;
    const stuckKey = `stuck_travel_resolved_${currentUser.email}`;
    if (sessionStorage.getItem(stuckKey)) return;
    sessionStorage.setItem(stuckKey, '1');
    base44.functions.invoke('completeStuckTravelUserScoped', {})
      .then(res => {
        const found = res?.data?.stuck_characters_found || 0;
        if (found > 0) {
          queryClient.invalidateQueries({ queryKey: ['characters', currentUser.email] });
        }
      })
      .catch(() => {});
  }, [currentUser?.email]);

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

  // Run lifecycle checker once per page-load session — checks education completions + jail auto-releases.
  // Gate key is per-user + per-session-instance (UUID), NOT date-based.
  // This means same-day enrollment changes, sentence extensions, or new completions will be
  // checked on the next page load, not blocked by a stale date key.
  useEffect(() => {
    if (!currentUser?.email) return;
    // Use a per-session instance key — cleared only when the tab is closed, not by date.
    // This prevents the "already checked today" false gate after same-day changes.
    const sessionInstanceKey = `lifecycle_session_${currentUser.email}`;
    if (sessionStorage.getItem(sessionInstanceKey)) return;
    sessionStorage.setItem(sessionInstanceKey, '1');
    base44.functions.invoke('checkLifecycleEvents', {})
      .then(res => {
        const data = res?.data;
        if (!data) return;
        // releases[] = characters already auto-released server-side (notification only)
        if (data.releases?.length > 0) {
          setPendingReleases(data.releases);
          // Invalidate so released characters no longer show jail status
          queryClient.invalidateQueries({ queryKey: ['characters', currentUser.email] });
        }
        // graduations[] = characters whose education end_date just passed (lifecycle processed)
        if (data.graduations?.length > 0) {
          setGraduationEvents(data.graduations);
          // Invalidate so updated student_status and completed_education reflect immediately
          queryClient.invalidateQueries({ queryKey: ['characters', currentUser.email] });
          queryClient.invalidateQueries({ queryKey: ['locationReferences', currentUser.email] });
        }
      })
      .catch(() => {});
  }, [currentUser?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time: patch individual character records in the cache without re-fetching the whole list.
  // CRITICAL: Never call invalidateQueries for character updates — it triggers a full 300-record
  // re-fetch on every automation write (dozens per minute), causing card flicker + 429 pressure.
  // Instead: surgically update the existing cache entry by id (create/update) or filter it out (delete).
  // For creates: invalidate once with a 10s debounce (new character must be fetched, can't patch from event alone).
  const charCreateTimerRef = useRef(null);
  useEffect(() => {
    if (!currentUser?.email) return;
    const email = currentUser.email;
    const unsubscribe = base44.entities.Character.subscribe((event) => {
      if (!event.data) return;

      if (event.type === "update") {
        // Surgical patch: update only the changed character in the existing cache, no re-fetch.
        queryClient.setQueryData(["characters", email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          const idx = prev.findIndex(c => c.id === event.data.id);
          if (idx === -1) return prev; // not in list — skip (e.g. another user's character)
          const next = [...prev];
          next[idx] = { ...prev[idx], ...event.data };
          return next;
        });

      } else if (event.type === "delete") {
        // Surgical remove — only if the deleted record belonged to this user.
        // CRITICAL: never remove a character from cache based solely on an id match
        // without confirming ownership. A delete event for another user's character
        // must not corrupt the current user's visible list.
        queryClient.setQueryData(["characters", email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          // Only remove if the record was actually in this user's list by id
          const exists = prev.some(c => c.id === event.data.id);
          if (!exists) return prev; // not ours — ignore
          return prev.filter(c => c.id !== event.data.id);
        });

      } else if (event.type === "create") {
        // New character: can't patch from event alone (may be missing fields).
        // Debounce a single full invalidation — 10s to absorb rapid sequential creates.
        if (charCreateTimerRef.current) clearTimeout(charCreateTimerRef.current);
        charCreateTimerRef.current = setTimeout(() => {
          charCreateTimerRef.current = null;
          queryClient.invalidateQueries({ queryKey: ["characters", email] });
        }, 10000);
      }
    });
    return () => {
      unsubscribe();
      if (charCreateTimerRef.current) {
        clearTimeout(charCreateTimerRef.current);
        charCreateTimerRef.current = null;
      }
    };
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

  // Guard: only run the prompt backfill once per default character ID per session.
  // Without this, every real-time Character update (dozens/min from automations) changes
  // the `characters` array reference, re-fires this effect, and triggers an
  // invalidateQueries → refetch → new reference → effect fires again loop.
  const promptBackfillDoneRef = useRef(null);
  useEffect(() => {
    const defaultChar = characters.find(c => c.is_default);
    if (!defaultChar) return;
    if (defaultChar.family_history && defaultChar.system_prompt_url) return;
    // Already attempted for this character ID this session — don't retry
    if (promptBackfillDoneRef.current === defaultChar.id) return;
    promptBackfillDoneRef.current = defaultChar.id;

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
      // Surgical cache patch instead of full invalidation — avoids triggering
      // another 300-record fetch just to update one character's system_prompt_url.
      queryClient.setQueryData(["characters", currentUser?.email], (prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map(c => c.id === defaultChar.id ? { ...c, ...updated } : c);
      });
    }).catch(() => {});
  }, [characters.find(c => c.is_default)?.id, currentUser?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isLoading && !currentUser?.email) {
      navigate("/");
    }
  }, [isLoading, currentUser?.email, navigate]);

  // Register page context so simulationGate knows home is active (no specific character/location)
  usePageContext({ page: 'home' });

  // Load active in_transit sessions — used to gate travel display (ONE TRUTH RULE)
  const { sessions: activeTravelSessions } = useTravelSessions(currentUser?.email);

  const defaultChar = allCharacters.find(c => c.is_default);
  const customChars = allCharacters.filter(c => !c.is_default && c.status !== "deleted");
  
  // Use unified resolver to get homepage-eligible characters from the full merged pool
  const { activeCharacters } = getCharactersForHomepage(customChars, currentUser?.id, currentUser?.email);
  
  // Sort active custom characters: anchor characters first (by their position in anchorCharacterIds),
  // then remaining characters alphabetically.
  // ANCHOR PRIORITY: Ethan (index 0) and Melody (index 1) must always appear before Shiloh or any
  // newer/lower-continuity character, regardless of created_date or name sort order.
  // LEGACY COMPATIBILITY: character_type may be absent on older records — these are resolved to
  // 'active_created_character' by the legacy fallback in useOwnedCharacters. Accept both the
  // resolved type (via _resolvedType) and the raw field to cover both paths.
  const isActiveCreated = (c) =>
    c.character_type === "active_created_character" ||
    c._resolvedType === "active_created_character" ||
    // Legacy: character_type absent entirely — trust it passed RLS and has profile data
    (!c.character_type && (c.personality_summary || c.personality_traits?.length > 0 || c.backstory));

  const activeCustomChars = activeCharacters
    .filter(c => (c.status === "active" || !c.status) && c.name !== "Leo Parker" && isActiveCreated(c))
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
  const movedAwayChars = customChars.filter(c => c.status === "moved_away");
  const canCreate = true;
  const canMoveBack = movedAwayChars.length > 0;
  const showPerformanceWarning = activeCustomChars.length >= 7;

  // Apply travel display integrity — gate "Traveling to…" on valid in_transit sessions
  const verifiedActiveCustomChars = applySessionProofToCharacters(activeCustomChars, activeTravelSessions);

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
              <CharacterCard character={defaultChar} locationMap={locationMap} locationData={{}} />
            </div>
          )}
          {(defaultChar && activeCustomChars.length >= 1) || activeCustomChars.length >= 2 ? (
            <CharacterInteractionSimulator
              currentUser={currentUser}
              characters={[
                ...(defaultChar ? [defaultChar] : []),
                ...activeCustomChars,
                ...allCharacters.filter(c =>
                  ['npc_fictitious', 'npc_family_member', 'npc_regular'].includes(c.character_type) &&
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