/**
 * usePageContext
 *
 * Registers the current page + active character/location in the simulation gate.
 * Call once per page (Chat, Scene, Travel, Home, CharacterProfile, Locations, Moments, Settings, etc.) on mount.
 *
 * USER FIRST RULE: Every page navigation activates a foreground priority window.
 * Background simulation must yield to whatever the user is currently viewing.
 *
 * Safe mode durations by page priority:
 *   chat    → 60s  (critical — user is actively messaging)
 *   scene   → 45s  (high — user is in an active scene)
 *   travel  → 30s  (high — user is viewing travel state)
 *   profile → 20s  (high — user is viewing a character)
 *   all others → 15s (medium — navigation/browsing)
 */

import { useEffect } from 'react';
import { setActiveContext, clearActiveContext, activateChatSafeMode } from '@/lib/simulationGate';
import { registerForegroundTask, FOREGROUND_TASKS, PRIORITY_LEVELS, signalUserActiveSession } from '@/lib/foregroundPriority';
import { base44 } from '@/api/base44Client';

const PAGE_SAFE_MODE_DURATION = {
  chat:    60000,
  scene:   45000,
  travel:  30000,
  profile: 20000,
  // All other pages get a 15s window — enough for the page to load and settle
  default: 15000,
};

const PAGE_FOREGROUND_TASK = {
  chat:      FOREGROUND_TASKS.CHAT_LOADING,
  scene:     FOREGROUND_TASKS.PAGE_LOAD,
  travel:    FOREGROUND_TASKS.TRAVEL_PAGE,
  profile:   FOREGROUND_TASKS.PROFILE_LOAD,
  moments:   FOREGROUND_TASKS.MOMENTS_PAGE,
  settings:  FOREGROUND_TASKS.SETTINGS_LOAD,
  locations: FOREGROUND_TASKS.PAGE_LOAD,
  home:      FOREGROUND_TASKS.PAGE_LOAD,
};

/**
 * @param {object} opts
 * @param {string} opts.page          — 'home' | 'chat' | 'scene' | 'travel' | 'profile' | 'moments' | 'settings' | 'locations'
 * @param {string} [opts.characterId] — active character id (chat/profile pages)
 * @param {string} [opts.locationId]  — active location id (scene page)
 */
export function usePageContext({ page, characterId = null, locationId = null }) {
  useEffect(() => {
    if (!page) return;

    // 1. Register the active page context in the simulation gate
    setActiveContext({ page, characterId, locationId });

    // 2. USER FIRST: Every page navigation activates chat-safe mode.
    //    Duration varies by page importance — chat gets the longest window,
    //    all other pages get at least 15s so they can load without background competition.
    const safeModeDuration = PAGE_SAFE_MODE_DURATION[page] ?? PAGE_SAFE_MODE_DURATION.default;
    activateChatSafeMode(safeModeDuration);

    // 2a. SERVER-SIDE YIELD TOKEN: Write to AppWorldState so background automations
    //     (simulateActiveCharacterNeeds, autonomousCharacterMovement) yield during active sessions.
    //     This bridges the browser→server priority gap that foregroundPriority.js cannot cover alone.
    //     Fire-and-forget — non-blocking, non-fatal.
    // High-priority pages (chat, scene, travel) get a full 3-minute server yield window.
    // Other pages get a shorter 90-second window since they don't generate ongoing API calls.
    const serverYieldMs = ['chat', 'scene', 'travel'].includes(page) ? 180000 : 90000;
    signalUserActiveSession(base44, serverYieldMs).catch(() => {});

    // 3. Register a foreground priority task for this page so background hooks
    //    that check isForegroundActive() / shouldYieldToForeground() also yield.
    //    Duration matches the safe mode window (page load should settle by then).
    const taskType = PAGE_FOREGROUND_TASK[page] ?? FOREGROUND_TASKS.PAGE_LOAD;
    const releaseFgTask = registerForegroundTask(taskType, PRIORITY_LEVELS.HIGH);

    // Auto-release foreground task after the safe mode window — background systems
    // can resume once the page has had time to fully load and settle.
    const releaseTimer = setTimeout(releaseFgTask, safeModeDuration);

    return () => {
      clearTimeout(releaseTimer);
      releaseFgTask();
      clearActiveContext(page);
    };
  }, [page, characterId, locationId]);
}