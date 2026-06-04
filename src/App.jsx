import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation, useParams, useSearchParams, Navigate } from 'react-router-dom';

import { useEffect } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ActiveCharacterProvider } from '@/lib/ActiveCharacterContext';
import PlayAsCharacterBanner from '@/components/chat/PlayAsCharacterBanner';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { useRoutePreservation } from '@/lib/useRoutePreservation';

import Onboarding from './pages/Onboarding';
import CommunityEventsDemo from './pages/CommunityEventsDemo';
import OnboardingGuard from './components/OnboardingGuard';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Text from './pages/Text';
import HolidayPopup from '@/components/holidays/HolidayPopup';
import GroupChat from './pages/GroupChat';
import Groups from './pages/Groups';
import CreateCharacter from './pages/CreateCharacter.jsx';
import Settings from './pages/Settings';
import CharacterProfile from './pages/CharacterProfile';
import DiagnosticChecklist from './pages/DiagnosticChecklist';
import AdminVerification from './pages/AdminVerification';
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
import MemoryReelCreator from './pages/MemoryReelCreator';
import MediaGallery from './pages/MediaGallery';
import Locations from './pages/Locations';


import Finance from './pages/Finance';
import EditCharacterTraits from './pages/EditCharacterTraits';
import ImageGenerationDiagnostics from './pages/ImageGenerationDiagnostics';
import SchoolContaminationProof from './pages/SchoolContaminationProof';
import EditCharacterReligion from './pages/EditCharacterReligion';
import AchievementUnlockModal from './components/achievements/AchievementUnlockModal';
import { LocationEditProvider } from '@/components/location/LocationEditConflictManager';
import { useState } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * ChatChannelMount
 *
 * Mounts the Chat shell in direct mode for /chat/:characterId.
 * If the legacy ?type=phone param is present, redirects to /text/:characterId
 * so old bookmarks/links still work without keeping the param as primary identity.
 */
function ChatChannelMount() {
  const { characterId } = useParams();
  const [searchParams] = useSearchParams();
  // Backward-compatible redirect: ?type=phone → /text/:characterId
  if (searchParams.get('type') === 'phone') {
    return <Navigate to={`/text/${characterId}`} replace />;
  }
  return <Chat key={`${characterId}:direct`} />;
}

/**
 * TextChannelMount
 *
 * Mounts the Chat shell in phone/text mode for /text/:characterId.
 * key={characterId:phone} guarantees a separate React instance from /chat/:characterId.
 * Passes chatTypeOverride="phone" so Chat reads it without needing ?type=phone in the URL.
 */
function TextChannelMount() {
  const { characterId } = useParams();
  return <Text key={`${characterId}:phone`} chatTypeOverride="phone" />;
}

const AuthenticatedApp = ({ holidaysEnabled }) => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Preserve current route across orientation changes and remounts (read-only — no navigate)
  useRoutePreservation();

  // PRIORITY ARCHITECTURE: ensureUserVGCTowers removed from App startup.
  // Infrastructure maintenance does not belong in the startup sequence.
  // VGC Towers existence is verified lazily when a location requiring them is first needed.
  // Correct priority class: Priority 6 — Scheduled maintenance (server-side automation).

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
      <Route path="/community-events-demo" element={<CommunityEventsDemo />} />
      <Route path="/chat/:characterId" element={<ChatChannelMount />} />
      <Route path="/text/:characterId" element={<TextChannelMount />} />
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
      <Route path="/memory-reel" element={<MemoryReelCreator />} />
      <Route path="/media-gallery" element={<MediaGallery />} />
      <Route path="/locations" element={<Locations />} />


      <Route path="/edit-character-relationships" element={<EditCharacterRelationships />} />
      <Route path="/edit-character-traits" element={<EditCharacterTraits />} />
      <Route path="/edit-character-religion" element={<EditCharacterReligion />} />
      <Route path="/edit-character-profile" element={<EditCharacterProfile />} />
      <Route path="/edit-character-needs" element={<EditCharacterNeeds />} />
      <Route path="/my-profile" element={<MyProfile />} />
      <Route path="/finance" element={<Finance />} />
      <Route path="/diagnostic" element={<DiagnosticChecklist />} />
      <Route path="/admin-verification" element={<AdminVerification />} />
      <Route path="/travel" element={<Travel />} />
      <Route path="/scene" element={<Scene />} />
      <Route path="/image-diagnostics" element={<ImageGenerationDiagnostics />} />
      <Route path="/school-contamination-proof" element={<SchoolContaminationProof />} />
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