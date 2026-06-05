import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { setForegroundPriority } from '@/lib/backgroundTaskThrottle';

const ForegroundPriorityContext = createContext(null);

/**
 * ForegroundPriorityProvider
 *
 * Single authority for foreground/background priority.
 * Updates sessionStorage for background tasks to read synchronously.
 * Background tasks MUST check this before making ANY requests.
 */
export function ForegroundPriorityProvider({ children }) {
  const location = useLocation();
  const [foregroundPriority, setForegroundPriorityState] = useState(false);

  useEffect(() => {
    const isUserFacingPage = 
      location.pathname.startsWith('/chat/') ||
      location.pathname.startsWith('/text/') ||
      location.pathname.startsWith('/profile/') ||
      location.pathname === '/travel' ||
      location.pathname === '/scene' ||
      location.pathname === '/media-gallery' ||
      location.pathname === '/settings' ||
      location.pathname === '/my-profile' ||
      location.pathname === '/create' ||
      location.pathname.startsWith('/edit-');

    setForegroundPriorityState(isUserFacingPage);
    setForegroundPriority(isUserFacingPage);
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