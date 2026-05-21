import { useState } from 'react';

export function useChatModals() {
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [showNarrativeBuilder, setShowNarrativeBuilder] = useState(false);
  const [showWorldContacts, setShowWorldContacts] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [forwardTarget, setForwardTarget] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);
  const [newPeopleDetected, setNewPeopleDetected] = useState(null);
  const [showSendMoney, setShowSendMoney] = useState(false);
  const [isSendingMoney, setIsSendingMoney] = useState(false);
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [showGameLauncher, setShowGameLauncher] = useState(false);
  const [showNarrativeAction, setShowNarrativeAction] = useState(false);
  const [showShopping, setShowShopping] = useState(false);
  const [showHousingModal, setShowHousingModal] = useState(false);
  const [showLocationShare, setShowLocationShare] = useState(false);
  const [pendingAliasResolution, setPendingAliasResolution] = useState(null);

  return {
    showStatusPopup, setShowStatusPopup,
    showNarrativeBuilder, setShowNarrativeBuilder,
    showWorldContacts, setShowWorldContacts,
    showTroubleshooting, setShowTroubleshooting,
    deleteTarget, setDeleteTarget,
    forwardTarget, setForwardTarget,
    shareTarget, setShareTarget,
    newPeopleDetected, setNewPeopleDetected,
    showSendMoney, setShowSendMoney,
    isSendingMoney, setIsSendingMoney,
    showMediaGallery, setShowMediaGallery,
    showGameLauncher, setShowGameLauncher,
    showNarrativeAction, setShowNarrativeAction,
    showShopping, setShowShopping,
    showHousingModal, setShowHousingModal,
    showLocationShare, setShowLocationShare,
    pendingAliasResolution, setPendingAliasResolution,
  };
}