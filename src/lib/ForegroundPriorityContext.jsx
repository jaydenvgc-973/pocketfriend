import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { setForegroundPriority } from '@/lib/backgroundTaskThrottle';
import { getRequestPriorityManager } from '@/lib/requestPriorityManager';

const ForegroundPriorityContext = createContext(null);

/**
 * ForegroundPriorityProvider
 *
 * Tracks whether the user is actively viewing a user-facing page.
 * Background systems check this flag and throttle/defer when true.
 *
 * User-facing pages (high priority):
 * - /chat/:characterId
 * - /text/:characterId
 * - /profile/:characterId
 * - /travel
 * - /scene
 *
 * Background systems (defer when user-facing page is active):
 * - Scheduled automations
 * - Proactive message generation
 * - Autonomous character movement
 * - Location enforcement
 * - Narrative generation
 */
export function ForegroundPriorityProvider({ children }) {
  const location = useLocation();
  const [foregroundPriority, setForegroundPriority] = useState(false);

  useEffect(() => {
    // Mark as foreground priority if user is on an active interaction page
    const isUserFacingPage = 
      location.pathname.startsWith('/chat/') ||
      location.pathname.startsWith('/text/') ||
      location.pathname.startsWith('/profile/') ||
      location.pathname === '/travel' ||
      location.pathname === '/scene' ||
      location.pathname === '/settings' ||
      location.pathname === '/my-profile';

    setForegroundPriority(isUserFacingPage);
    // Also notify background systems
    try {
      sessionStorage.setItem('foregroundPriority', isUserFacingPage ? 'true' : 'false');
    } catch {}

    // Manage request priority — cancel background requests when user-facing page activates
    const manager = getRequestPriorityManager();
    if (isUserFacingPage) {
      manager.activateForeground();
    } else {
      manager.deactivateForeground();
    }
  }, [location.pathname]);

  return (
    <ForegroundPriorityContext.Provider value={{ foregroundPriority }}>
      {children}
    </ForegroundPriorityContext.Provider>
  );
}

export function useForegroundPriority() {
  const context = useContext(ForegroundPriorityContext);
  if (!context) {
    return { foregroundPriority: false };
  }
  return context;
}