import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ActiveCharacterProvider } from '@/lib/ActiveCharacterContext';
import PlayAsCharacterBanner from '@/components/chat/PlayAsCharacterBanner';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { useRoutePreservation } from '@/lib/useRoutePreservation';

import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import Chat from './pages/Chat';
import GroupChat from './pages/GroupChat';
import Groups from './pages/Groups';
import CreateCharacter from './pages/CreateCharacter.jsx';
import Settings from './pages/Settings';
import CharacterProfile from './pages/CharacterProfile';
import EditDefaultCharacter from './pages/EditDefaultCharacter';
import EditCharacterStory from './pages/EditCharacterStory';
import EditCharacterPhotos from './pages/EditCharacterPhotos';
import EditCharacterEmotions from './pages/EditCharacterEmotions';
import EditCharacterRelationships from './pages/EditCharacterRelationships';
import EditCharacterProfile from './pages/EditCharacterProfile';
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

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const location = useLocation();
  
  // Preserve current route across orientation changes and remounts
  useRoutePreservation();

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
      <Route path="/" element={<Onboarding />} />
      <Route path="/home" element={<Home />} />
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
      <Route path="/my-profile" element={<MyProfile />} />
      <Route path="/finance" element={<Finance />} />
      <Route path="/travel" element={<Travel />} />
      <Route path="/scene" element={<Scene />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  // Prevent unintended navigation on orientation change
  useEffect(() => {
    const handleOrientationChange = () => {
      // Orientation changed, but do NOT navigate
      // Current route will be preserved by useRoutePreservation hook in AuthenticatedApp
      console.log('Orientation changed — route preserved');
    };

    window.addEventListener('orientationchange', handleOrientationChange);
    return () => window.removeEventListener('orientationchange', handleOrientationChange);
  }, []);

  return (
    <AuthProvider>
      <ActiveCharacterProvider>
        <LocationEditProvider>
          <QueryClientProvider client={queryClientInstance}>
            <Router>
              <PlayAsCharacterBanner />
              <AuthenticatedApp />
            </Router>
            <AchievementUnlockModal />
            <Toaster />
          </QueryClientProvider>
        </LocationEditProvider>
      </ActiveCharacterProvider>
    </AuthProvider>
  )
}

export default App