import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';

/**
 * useForegroundSessionTracking
 * 
 * Writes to AppWorldState.user_active_session when user is in a foreground page.
 * Background functions read this flag to yield if active.
 * 
 * Foreground pages: Chat, Text, Profile, Travel, Scene, Settings, Finance, Moments, MediaGallery, etc.
 * Background pages: Onboarding, Diagnostic, AdminVerification, etc.
 */
const FOREGROUND_PATHS = [
  '/chat',
  '/text',
  '/profile',
  '/travel',
  '/scene',
  '/settings',
  '/finance',
  '/moments',
  '/memory-reel',
  '/media-gallery',
  '/locations',
  '/groups',
  '/group-chat',
  '/home',
  '/',
];

export function useForegroundSessionTracking() {
  const location = useLocation();

  useEffect(() => {
    const isForeground = FOREGROUND_PATHS.some(path => location.pathname.startsWith(path));

    if (!isForeground) return;

    const updateSessionFlag = async () => {
      try {
        // Write/update the user_active_session flag in AppWorldState
        // This flag is read by background functions to yield if user is actively using the app
        await base44.entities.AppWorldState.filter({ key: 'user_active_session' }).then(async (records) => {
          if (records.length > 0) {
            // Update existing flag with current timestamp
            await base44.entities.AppWorldState.update(records[0].id, {
              value: new Date().toISOString(),
            });
          } else {
            // Create new flag
            await base44.entities.AppWorldState.create({
              key: 'user_active_session',
              value: new Date().toISOString(),
            });
          }
        });
      } catch (err) {
        // Silent fail — not critical if flag doesn't update
        // Background functions have fallback behavior
        console.debug('[useForegroundSessionTracking] Failed to update session flag:', err.message);
      }
    };

    updateSessionFlag();

    // Keep updating the flag every 30 seconds while user is on foreground page
    const interval = setInterval(updateSessionFlag, 30000);
    return () => clearInterval(interval);
  }, [location.pathname]);
}