import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Hook to preserve the current route across orientation changes and component remounts.
 * Stores the active route in sessionStorage so it can be restored if needed.
 */
export const useRoutePreservation = () => {
  const location = useLocation();
  const lastKnownRouteRef = useRef(null);

  useEffect(() => {
    // Store the current route in sessionStorage whenever it changes
    // This survives page reloads and orientation changes
    sessionStorage.setItem('lastKnownRoute', location.pathname + location.search);
    lastKnownRouteRef.current = location.pathname + location.search;
  }, [location.pathname, location.search]);

  return lastKnownRouteRef.current;
};

/**
 * Get the last known route from sessionStorage.
 * Returns null if nothing was stored.
 */
export const getLastKnownRoute = () => {
  return sessionStorage.getItem('lastKnownRoute');
};

/**
 * Clear the last known route from sessionStorage.
 */
export const clearLastKnownRoute = () => {
  sessionStorage.removeItem('lastKnownRoute');
};