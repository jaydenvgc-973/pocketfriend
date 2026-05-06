import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';

import { useEffect } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ActiveCharacterProvider } from '@/lib/ActiveCharacterContext';
import PlayAsCharacterBanner from '@/components/chat/PlayAsCharacterBanner';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { useRoutePreservation } from '@/lib/useRoutePreservation';

import Onboarding from './pages/Onboarding';
import OnboardingGuard from './components/OnboardingGuard';
import Home from './pages/Home';
import Chat from './pages/Chat';
import HolidayPopup from '@/components/holidays/HolidayPopup';
import GroupChat from './pages/GroupChat';
import Groups from './pages/Groups';
import CreateCharacter from './pages/CreateCharacter.jsx';
import Settings from './pages/Settings';
import CharacterProfile from './pages/CharacterProfile';
import DiagnosticChecklist from './pages/DiagnosticChecklist';
import EditDefaultCharacter from './pages/EditDefaultCharacter';
import EditCharacterStory from './pages/EditCharacterStory';
import EditCharacterPhotos from './pages/EditCharacterPhotos';
import EditCharacterEmotions from './pages/EditCharacterEmotions';
import EditCharacterRelationships from './pages/EditCharacterRelationships';
import EditCharacterProfile from './pages/EditCharacterProfile';
import EditCharacterNeeds from './pages/EditCharacterNeeds';
import MyProfile from './pages/MyProfile';
import Travel from './pages/Travel';
import Scene from './pages/Scene';
import Moments from './pages/Moments';
import Locations from './pages/Locations';
import Finance from './pages/Finance';
import EditCharacterTraits from './pages/EditCharacterTraits';
import EditCharacterReligion from './pages/EditCharacterReligion';
import AchievementUnlockModal from './components/achievements/AchievementUnlockModal';
import { LocationEditProvider } from '@/components/location/LocationEditConflictManager';
import { useState } from 'react';
import { base44 } from '@/api/base44Client';

const AuthenticatedApp = ({ holidaysEnabled }) => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Preserve current route across orientation changes and remounts (read-only — no navigate)
  useRoutePreservation();

  useEffect(() => {
    // Session-gated: only run once per browser session to avoid 429 storms on repeated mounts.
    const vgcInitKey = 'vgc_towers_initialized';
    if (sessionStorage.getItem(vgcInitKey)) return;
    sessionStorage.setItem(vgcInitKey, '1');
    base44.functions.invoke('ensureUserVGCTowers', {}).catch(() => {});
  }, []);

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route path="/" element={<OnboardingGuard><Home /></OnboardingGuard>} />
      <Route path="/home" element={<OnboardingGuard><Home /></OnboardingGuard>} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/chat/:characterId" element={<Chat />} />
      <Route path="/groups" element={<Groups />} />
      <Route path="/group-chat" element={<GroupChat />} />
      <Route path="/create" element={<CreateCharacter />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/profile/:characterId" element={<CharacterProfile />} />
      <Route path="/edit-default" element={<EditDefaultCharacter />} />
      <Route path="/edit-character-story" element={<EditCharacterStory />} />
      <Route path="/edit-character-photos" element={<EditCharacterPhotos />} />
      <Route path="/edit-character-emotions" element={<EditCharacterEmotions />} />
      <Route path="/moments" element={<Moments />} />
      <Route path="/locations" element={<Locations />} />
      <Route path="/edit-character-relationships" element={<EditCharacterRelationships />} />
      <Route path="/edit-character-traits" element={<EditCharacterTraits />} />
      <Route path="/edit-character-religion" element={<EditCharacterReligion />} />
      <Route path="/edit-character-profile" element={<EditCharacterProfile />} />
      <Route path="/edit-character-needs" element={<EditCharacterNeeds />} />
      <Route path="/my-profile" element={<MyProfile />} />
      <Route path="/finance" element={<Finance />} />
      <Route path="/diagnostic" element={<DiagnosticChecklist />} />
      <Route path="/travel" element={<Travel />} />
      <Route path="/scene" element={<Scene />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  const [holidaysEnabled, setHolidaysEnabled] = useState(false);

  // Check if holidays are enabled — session-gated to prevent 429 on every mount
  useEffect(() => {
    const sessionKey = 'holiday_setting_checked';
    if (sessionStorage.getItem(sessionKey)) return;

    const checkHolidaysSetting = async () => {
      try {
        const me = await base44.auth.me().catch(() => null);
        if (!me?.email) return;
        const settingsList = await base44.entities.UserSettings.filter({ owner_email: me.email });
        if (settingsList[0]) {
          setHolidaysEnabled(settingsList[0].holiday_observation_enabled !== false);
        }
        sessionStorage.setItem(sessionKey, '1');
      } catch (error) {
        const is429 = error?.message?.includes('429') || error?.status === 429;
        if (!is429) console.warn('Failed to check holiday setting:', error?.message);
        // Don't set session key on failure — allow retry next navigation
      }
    };
    checkHolidaysSetting();
  }, []);



  return (
    <AuthProvider>
      <ActiveCharacterProvider>
        <LocationEditProvider>
          <QueryClientProvider client={queryClientInstance}>
            <Router>
              <PlayAsCharacterBanner />
              <AuthenticatedApp holidaysEnabled={holidaysEnabled} />
            </Router>
            <HolidayPopup isEnabled={holidaysEnabled} />
            <AchievementUnlockModal />
            <Toaster />
          </QueryClientProvider>
        </LocationEditProvider>
      </ActiveCharacterProvider>
    </AuthProvider>
  )
}

export default App