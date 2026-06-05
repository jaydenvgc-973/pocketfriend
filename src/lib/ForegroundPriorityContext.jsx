import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getForegroundRequestGate } from '@/lib/foregroundRequestGate';

const ForegroundPriorityContext = createContext(null);

/**
 * ForegroundPriorityProvider
 *
 * Enforces strict foreground priority using an activity-based gate.
 * 
 * RULE: Background requests are COMPLETELY BLOCKED while the user is on
 * a foreground page. No timers. No windows. No resume countdown.
 *
 * Background only proceeds when:
 * 1. User navigates AWAY from all foreground pages
 * 2. AND no active user-facing operations are in progress
 *
 * User-facing pages (high priority):
 * - /chat/:characterId
 * - /text/:characterId
 * - /profile/:characterId
 * - /travel
 * - /scene
 * - /media-gallery
 * - /world-contacts (global chat)
 * - Character create/edit pages
 */
export function ForegroundPriorityProvider({ children }) {
  const location = useLocation();
  const [foregroundPriority, setForegroundPriority] = useState(false);

  useEffect(() => {
    // Determine if user is on a foreground page
    const isUserFacingPage = 
      location.pathname.startsWith('/chat/') ||
      location.pathname.startsWith('/text/') ||
      location.pathname.startsWith('/profile/') ||
      location.pathname === '/travel' ||
      location.pathname === '/scene' ||
      location.pathname === '/media-gallery' ||
      location.pathname === '/world-contacts' ||
      location.pathname === '/settings' ||
      location.pathname === '/my-profile' ||
      location.pathname === '/create' ||
      location.pathname.startsWith('/edit-');

    setForegroundPriority(isUserFacingPage);

    // Gate background requests using the activity-based gate
    const gate = getForegroundRequestGate();
    if (isUserFacingPage) {
      gate.enterForegroundPage();
    } else {
      gate.leaveForegroundPage();
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

/**
 * Hook for components to track active user-facing operations
 */
export function useForegroundOperation() {
  const gate = getForegroundRequestGate();

  useEffect(() => {
    gate.startActiveOperation();
    return () => gate.finishActiveOperation();
  }, []);
}