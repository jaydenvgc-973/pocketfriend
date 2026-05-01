import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, Loader2, RefreshCw, Wand2, MapPin, ChevronDown, Users, Check, ImagePlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { fetchUnifiedRoster, getInitial } from "@/lib/unifiedRosterUtils";
import RegenerateImageModal from "@/components/chat/RegenerateImageModal";
import { validateSelectedPeopleIdentities, buildMultiPersonPayload } from "@/lib/mediaGridIdentityLock";

function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isProviderAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

export default function MediaGallery({ messages, onDeleteImage, character, conversationId, onImageGenerated, externalTrigger, onExternalClose }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (externalTrigger) { setIsOpen(true); onExternalClose?.(); }
  }, [externalTrigger]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [regenTarget, setRegenTarget] = useState(null); // { id, url } of image to regenerate
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [generationTab, setGenerationTab] = useState("character"); // "character" | "user"

  // Prompt generator state
  const [prompt, setPrompt] = useState("");
  const [referenceImageUrl, setReferenceImageUrl] = useState(null);
  const [referenceImageSource, setReferenceImageSource] = useState(null);
  const [referenceImageMode, setReferenceImageMode] = useState("prompt_plus_image"); // prompt_only | image_only | prompt_plus_image
  const [referenceImagePurpose, setReferenceImagePurpose] = useState("general"); // pose | placement | background | lighting | composition | general
  const [showGridPicker, setShowGridPicker] = useState(false);
  const [isUploadingRef, setIsUploadingRef] = useState(false);
  const uploadInputRef = useRef(null);
  const [isAutoPrompting, setIsAutoPrompting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  // Environment selector state
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null); // full location object
  const [selectedZone, setSelectedZone] = useState(null);         // zone_name string
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showZonePicker, setShowZonePicker] = useState(false);
  
  // Character selector state
  const [selectedCharacterIds, setSelectedCharacterIds] = useState([]);
  const [showCharacterPicker, setShowCharacterPicker] = useState(false);

  // User settings for world name
  const [userSettings, setUserSettings] = useState(null);
  const [allCharacters, setAllCharacters] = useState([]);

  // Get current user's email for character fetching
  const [userEmail, setUserEmail] = useState(null);
  useEffect(() => {
    base44.auth.me()
      .then(user => setUserEmail(user?.email))
      .catch(() => {});
  }, []);

  // Load locations, user settings, and unified roster when modal opens
  // CRITICAL: ALL fetches are scoped to the authenticated userEmail — never use .list() without a filter
  useEffect(() => {
    if (!isOpen || !userEmail) return;
    Promise.all([
      base44.functions.invoke('fetchAllLocationsForUser', {})
        .then(res => setLocations(res?.data?.locations || []))
        .catch(() => {}),
      // ACCOUNT-SCOPED: filter by created_by so we never read another user's settings
      base44.entities.UserSettings.filter({ created_by: userEmail })
        .then(settingsList => setUserSettings(settingsList?.[0] || null))
        .catch(() => {}),
      fetchUnifiedRoster(base44, userEmail)
        .then(roster => {
          setAllCharacters(roster || []);
        })
        .catch(() => {}),
    ]);
  }, [isOpen, userEmail]);

  const availableZones = selectedLocation?.zones?.filter(z => z.image_urls?.length > 0) || [];

  const clearEnvironment = () => {
    setSelectedLocation(null);
    setSelectedZone(null);
  };

  const toggleCharacter = (charId) => {
    setSelectedCharacterIds(prev =>
      prev.includes(charId) ? prev.filter(id => id !== charId) : [...prev, charId]
    );
  };

  const clearSelectedCharacters = () => {
    setSelectedCharacterIds([]);
  };

  const handleRefUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingRef(true);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      setReferenceImageUrl(res.file_url);
      setReferenceImageSource('upload');
    } finally {
      setIsUploadingRef(false);
    }
  };

  const handlePickFromGallery = (img) => {
    setReferenceImageUrl(img.url);
    setReferenceImageSource('gallery');
    setShowGridPicker(false);
  };

  const clearReference = () => {
    setReferenceImageUrl(null);
    setReferenceImageSource(null);
    setReferenceImageMode("prompt_plus_image");
    setReferenceImagePurpose("general");
  };

  const handleAutoPrompt = async () => {
    if (!character) return;
    setIsAutoPrompting(true);
    try {
      const charDesc = [character.appearance_notes, character.personality_summary, character.age_range, character.gender, character.city].filter(Boolean).join(', ');
      const generated = await base44.integrations.Core.InvokeLLM({
        prompt: `Write a short, vivid image generation prompt (1-2 sentences) for a candid, realistic photo of a character named ${character.name} (${charDesc || 'a person'}). Make it a natural everyday moment — something authentic and interesting. Return ONLY the prompt text, nothing else.`,
      });
      setPrompt(generated?.trim() || "");
    } finally {
      setIsAutoPrompting(false);
    }
  };

  const images = messages
    .filter(msg => msg.image_url)
    .map(msg => ({
      id: msg.id,
      url: msg.image_url,
      senderType: msg.sender_type,
      senderName: msg.character_name || "You",
      timestamp: msg.timestamp,
    }));

  const handleRegenSelect = async (reason, customPrompt, manualLocationId = null, manualZoneId = null, directLocationImages = null, directLocationName = null) => {
    if (!regenTarget) return;
    setIsRegenerating(true);
    try {
      const res = await base44.functions.invoke('regenerateImageWithReason', {
        messageId: regenTarget.id,
        reason,
        customPrompt,
        manualLocationId: manualLocationId || null,
        manualZoneId: manualZoneId || null,
        directLocationImages: directLocationImages || null,
        directZoneName: manualZoneId || null,
        directLocationName: directLocationName || null,
      });
      if (res?.data?.success && res?.data?.image_url) {
        // Hydrate gallery immediately so updated image shows without reload
        setRegenTarget(null);
      }
    } catch (err) {
      console.error('[MediaGallery.handleRegenSelect] regen failed:', err.message);
    } finally {
      setIsRegenerating(false);
      setRegenTarget(null);
    }
  };

  // ── SHARED GENERATE HANDLER ────────────────────────────────────────────────
  // Source-of-truth model: use exactly what the user selected. No guessing.
  const handleGenerate = async (subjectType) => {
    if (!character || !conversationId) return;
    const promptText = referenceImageMode === "image_only"
      ? (prompt.trim() || "realistic candid photo, match the visual style and composition of the reference image")
      : (prompt.trim() || "candid natural moment, everyday life");

    // Resolve zone images from the selected location/zone — exactly what the UI shows
    const zoneImageUrls = selectedLocation
      ? (selectedZone
          ? (selectedLocation.zones?.find(z => z.zone_name === selectedZone)?.image_urls || [])
          : (selectedLocation.zones?.find(z => z.image_urls?.length > 0)?.image_urls || selectedLocation.image_urls || [])
        )
      : [];

    // Validate: if location selected but zone has no images, stop early with clear message
    if (selectedLocation && zoneImageUrls.length === 0) {
      setGenerateError(`"${selectedLocation.name}"${selectedZone ? ` → "${selectedZone}"` : ''} has no zone photos. Add photos to this zone before generating.`);
      return;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // HARD IDENTITY LOCK: Validate ALL selected people have visual references
    // ═════════════════════════════════════════════════════════════════════════
    let selectedPeople = null;
    if (selectedCharacterIds.length > 0) {
      // Multi-person image: validate all selected people
      const validation = await validateSelectedPeopleIdentities(
        base44,
        selectedCharacterIds,
        false, // includeUser — only set if user is in selectedCharacterIds
        userEmail,
        character.id,
        allCharacters
      );

      if (!validation.valid) {
        setGenerateError(validation.errors.join('\n'));
        return;
      }
      selectedPeople = validation.selectedPeople;
      console.log(`[MediaGallery] Identity lock PASSED for ${selectedCharacterIds.length} selected people`);
    }
    // If no multi-select, use single-character mode (existing path)

    // Build user refs for user/joint subject types (single-character fallback)
    const userChar = allCharacters.find(c => c.is_user);
    const userRefImages = subjectType !== 'character'
      ? [
          ...(userChar?.reference_image_urls || []).slice(0, 3),
          ...(userChar?.generated_avatar_urls || []).slice(0, 1),
          userChar?.avatar_url,
        ].filter(Boolean)
      : [];

    // Build primary character refs from their avatar + reference photos
    const charRefImages = [
      character.avatar_url,
      ...(character.reference_image_urls || []).slice(0, 2),
    ].filter(Boolean);

    setIsGenerating(true);
    setGenerateError(null);
    try {
      // Log identity lock validation chain
      console.log(`[MediaGallery.handleGenerate] ═══════════════════════════════════════════════`);
      console.log(`[MediaGallery.handleGenerate] IDENTITY LOCK VALIDATION`);
      console.log(`[MediaGallery.handleGenerate] Selected characters: ${selectedCharacterIds.length}`);
      if (selectedPeople) {
        console.log(`[MediaGallery.handleGenerate]   Primary: ${selectedPeople.character?.id} → refs: ${selectedPeople.character?.refs?.length || 0}`);
        selectedPeople.others.forEach((ch, i) => {
          console.log(`[MediaGallery.handleGenerate]   Other ${i}: ${ch.id} → refs: ${ch.refs?.length || 0}`);
        });
        if (selectedPeople.user) {
          console.log(`[MediaGallery.handleGenerate]   User → refs: ${selectedPeople.user?.refs?.length || 0}`);
        }
      }
      console.log(`[MediaGallery.handleGenerate] ═══════════════════════════════════════════════`);

      // Create placeholder message
      const newMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: subjectType === 'user' ? 'user' : 'character',
        character_id: subjectType !== 'user' ? character.id : undefined,
        character_name: subjectType !== 'user' ? character.name : undefined,
        content: "",
        emotional_state: character.emotional_state || "calm",
        timestamp: new Date().toISOString(),
      });
      if (!newMsg?.id) throw new Error('Failed to create message');

      const genRes = await base44.functions.invoke('mediaGridGenerate', {
        messageId: newMsg.id,
        prompt: promptText,
        subjectType,
        // Character identity
        characterId: character.id,
        characterName: character.name,
        characterRefImages: charRefImages,
        // User identity
        userRefImages,
        userName: userSettings?.fictional_world_name || userChar?.world_name || userChar?.name || 'the user',
        // Environment — exactly what the user selected
        locationId: selectedLocation?.id || null,
        locationName: selectedLocation?.name || null,
        zoneName: selectedZone || (selectedLocation ? selectedLocation.zones?.find(z => z.image_urls?.length > 0)?.zone_name : null) || null,
        zoneImageUrls,
        // HARD IDENTITY LOCK: Multi-person selection with validated references
        multiPersonSelection: selectedPeople ? buildMultiPersonPayload(
          selectedPeople,
          promptText,
          selectedLocation?.id || null,
          selectedZone || null
        ) : null,
        // User-uploaded reference image for visual guidance
        referenceImageUrl: referenceImageUrl || null,
        referenceImageMode: referenceImageUrl ? referenceImageMode : 'prompt_only',
        referenceImagePurpose: referenceImageUrl ? referenceImagePurpose : null,
      });

      if (genRes?.data?.filtered) {
        await base44.entities.Message.delete(newMsg.id).catch(() => {});
        throw new Error('Image blocked by content filter. Try rephrasing.');
      }
      if (!genRes?.data?.success || !genRes?.data?.imageUrl) {
        await base44.entities.Message.delete(newMsg.id).catch(() => {});
        throw new Error(genRes?.data?.error || 'Image generation failed.');
      }

      // Memory note
      const envNote = selectedLocation ? ` at ${selectedLocation.name}${selectedZone ? ` → ${selectedZone}` : ''}` : '';
      base44.entities.Memory.create({
        character_id: character.id,
        title: `Sent a photo`,
        description: `Sent a photo${envNote}. Prompt: "${promptText.substring(0, 80)}".`,
        emotional_impact: 'positive',
        timestamp: new Date().toISOString(),
        source_context: `gallery_generated_${newMsg.id}`,
      }).catch(() => {});

      setPrompt("");
      setReferenceImageUrl(null);
      setReferenceImageSource(null);
      setReferenceImageMode("prompt_plus_image");
      setReferenceImagePurpose("general");
      setShowGridPicker(false);
      setIsOpen(false);
      if (onImageGenerated) onImageGenerated({ ...newMsg, image_url: genRes.data.imageUrl });
    } catch (err) {
      setGenerateError(err.message || "Failed to generate image");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>

      {/* Media modal */}
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
              onClick={() => setIsOpen(false)}
            >
              <div
                className="bg-card rounded-2xl max-w-5xl w-full max-h-[99vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
                  <h3 className="text-lg font-semibold text-foreground">
                    Media {images.length > 0 ? `(${images.length})` : ""}
                  </h3>
                  <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                </div>

                {/* Generate image panel — above images */}
                {character && conversationId && (
                  <div className="flex-shrink-0 overflow-y-auto border-b border-border bg-primary/5 mx-6 mt-4 mb-2 p-4 space-y-3 rounded-xl" style={{ maxHeight: '50vh' }}>
                    {/* Tab switcher */}
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => setGenerationTab("character")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${generationTab === "character" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                      >
                        {character.name}
                      </button>
                      <button
                        onClick={() => setGenerationTab("user")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${generationTab === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                      >
                        {userSettings?.fictional_world_name || allCharacters.find(c => c.is_user)?.world_name || "You"}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <p className="text-sm font-medium text-foreground">
                        {generationTab === "character" ? `Generate a photo from ${character.name}` : `Generate a photo of ${userSettings?.fictional_world_name || allCharacters.find(c => c.is_user)?.world_name || "you"}`}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {generationTab === "character" ? `${character.name} will "send" it in the chat and remember it.` : "Generate and send a photo of yourself in the chat."}
                    </p>

                    {/* Character selector */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Character picker button */}
                        <button
                          onClick={() => { setShowCharacterPicker(v => !v); setShowLocationPicker(false); setShowZonePicker(false); }}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-colors ${selectedCharacterIds.length > 0 ? 'bg-primary/10 border-primary/40 text-primary' : 'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-primary/40'}`}
                        >
                          <Users className="w-3.5 h-3.5" />
                          {selectedCharacterIds.length > 0 ? `${selectedCharacterIds.length} selected` : 'Add people'}
                          <ChevronDown className="w-3 h-3" />
                        </button>

                        {/* Clear button */}
                        {selectedCharacterIds.length > 0 && (
                          <button onClick={clearSelectedCharacters} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors" title="Clear people">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Character picker dropdown */}
                      {showCharacterPicker && allCharacters.length > 0 && (
                        <div className="rounded-xl border border-border bg-card shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                          {/* User first, then all characters (sorted by active) */}
                          {(() => {
                            const seenIds = new Set();
                            const sorted = [];
                            
                            // 1. Add user first
                            const userChar = allCharacters.find(c => c.is_user);
                            if (userChar) {
                              sorted.push(userChar);
                              seenIds.add(userChar.id);
                            }
                            
                            // 2. Add current character if not already added
                            if (character?.id && !seenIds.has(character.id)) {
                              const curr = allCharacters.find(c => c.id === character.id);
                              if (curr) {
                                sorted.push(curr);
                                seenIds.add(character.id);
                              }
                            }
                            
                            // 3. Add all remaining active characters
                            allCharacters.forEach(c => {
                              if (!seenIds.has(c.id) && c.is_active_character && !c.is_user) {
                                sorted.push(c);
                                seenIds.add(c.id);
                              }
                            });
                            
                            // 4. Add all remaining characters
                            allCharacters.forEach(c => {
                              if (!seenIds.has(c.id)) {
                                sorted.push(c);
                                seenIds.add(c.id);
                              }
                            });
                            
                            return sorted;
                          })().map(char => (
                            <button
                              key={char.id}
                              onClick={() => toggleCharacter(char.id)}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-secondary transition-colors border-b border-border last:border-b-0 ${selectedCharacterIds.includes(char.id) ? 'bg-primary/10 text-primary' : 'text-foreground'}`}
                            >
                              {selectedCharacterIds.includes(char.id) && <Check className="w-3.5 h-3.5 text-primary" />}
                              {char.avatar_url && char.avatar_url.trim() ? (
                                <img src={char.avatar_url} alt={char.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" onError={(e) => { e.target.style.display = 'none'; }} />
                              ) : (
                                <div className={`w-6 h-6 rounded-full ${char.is_world_person ? 'bg-purple-500' : 'bg-primary/20'} flex items-center justify-center text-[10px] font-bold ${char.is_world_person ? 'text-white' : 'text-primary'} flex-shrink-0`}>{getInitial(char.name)}</div>
                              )}
                              <span className="font-medium">{char.name}</span>
                              {char.is_user && <span className="text-[10px] text-primary/60 ml-auto">(You)</span>}
                              {char.is_world_person && <span className="text-[10px] text-muted-foreground/60 ml-auto">{char.source_character_name}</span>}
                              {char.is_active_character && !char.is_user && <span className="text-[10px] text-primary/60 ml-auto">Active</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Environment selector */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Location picker button */}
                        <button
                          onClick={() => { setShowLocationPicker(v => !v); setShowZonePicker(false); }}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-colors ${selectedLocation ? 'bg-primary/10 border-primary/40 text-primary' : 'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-primary/40'}`}
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          {selectedLocation ? selectedLocation.name : 'Choose Location'}
                          <ChevronDown className="w-3 h-3" />
                        </button>

                        {/* Zone picker button — only if location selected and has zones */}
                        {selectedLocation && availableZones.length > 0 && (
                          <button
                            onClick={() => { setShowZonePicker(v => !v); setShowLocationPicker(false); }}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-colors ${selectedZone ? 'bg-primary/10 border-primary/40 text-primary' : 'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-primary/40'}`}
                          >
                            {selectedZone ? selectedZone : 'Choose Zone'}
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        )}

                        {/* Clear button */}
                        {selectedLocation && (
                          <button onClick={clearEnvironment} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors" title="Clear environment">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Selected environment display */}
                      {selectedLocation && (
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-primary/5 border border-primary/20">
                          {/* Zone thumbnail if available */}
                          {selectedZone && (() => {
                            const zone = availableZones.find(z => z.zone_name === selectedZone);
                            return zone?.image_urls?.[0] ? (
                              <img src={zone.image_urls[0]} alt={selectedZone} className="w-10 h-10 rounded-md object-cover flex-shrink-0 ring-1 ring-primary/30" />
                            ) : null;
                          })()}
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-primary leading-tight">{selectedLocation.name}</p>
                            {selectedZone && <p className="text-[10px] text-primary/70">{selectedZone}</p>}
                            {!selectedZone && availableZones.length > 0 && <p className="text-[10px] text-muted-foreground/60">No zone selected — will use first available</p>}
                          </div>
                        </div>
                      )}

                      {/* Location picker dropdown */}
                      {showLocationPicker && locations.length > 0 && (
                        <div className="rounded-xl border border-border bg-card shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                          {locations.map(loc => (
                            <button
                              key={loc.id}
                              onClick={() => { setSelectedLocation(loc); setSelectedZone(null); setShowLocationPicker(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-secondary transition-colors ${selectedLocation?.id === loc.id ? 'bg-primary/10 text-primary' : 'text-foreground'}`}
                            >
                              <MapPin className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                              <span className="font-medium">{loc.name}</span>
                              {loc.location_type === 'character_specific' && loc.character_name && (
                                <span className="text-muted-foreground/60 ml-auto">{loc.character_name}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Zone picker dropdown */}
                      {showZonePicker && availableZones.length > 0 && (
                        <div className="rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                          {availableZones.map(zone => (
                            <button
                              key={zone.zone_name}
                              onClick={() => { setSelectedZone(zone.zone_name); setShowZonePicker(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-secondary transition-colors ${selectedZone === zone.zone_name ? 'bg-primary/10 text-primary' : 'text-foreground'}`}
                            >
                              {zone.image_urls?.[0] && (
                                <img src={zone.image_urls[0]} alt={zone.zone_name} className="w-8 h-8 rounded-md object-cover flex-shrink-0" />
                              )}
                              <span className="font-medium">{zone.zone_name}</span>
                              <span className="ml-auto text-muted-foreground/50">{zone.image_urls?.length || 0} ref{zone.image_urls?.length !== 1 ? 's' : ''}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Prompt textarea + auto-generate */}
                    <div className="relative">
                      <textarea
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder={referenceImageUrl && referenceImageMode === "image_only" ? "Image-only mode — no prompt needed" : "Describe a scene... or click ✨ to auto-generate"}
                        rows={2}
                        className="w-full px-3 py-2.5 pr-10 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        onClick={handleAutoPrompt}
                        disabled={isAutoPrompting}
                        title="Auto-generate a prompt"
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                      >
                        {isAutoPrompting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {/* Upload reference image for visual guidance */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          ref={uploadInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleRefUpload}
                        />
                        <button
                          onClick={() => uploadInputRef.current?.click()}
                          disabled={isUploadingRef}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-colors ${referenceImageUrl ? 'bg-primary/10 border-primary/40 text-primary' : 'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-primary/40'}`}
                        >
                          {isUploadingRef ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                          {referenceImageUrl ? 'Reference uploaded' : 'Upload reference image'}
                        </button>
                        {referenceImageUrl && (
                          <button onClick={clearReference} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors" title="Remove reference">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {referenceImageUrl && (
                        <div className="flex gap-3 items-start p-2.5 rounded-xl bg-primary/5 border border-primary/20">
                          <img src={referenceImageUrl} alt="Reference" className="w-14 h-14 rounded-lg object-cover flex-shrink-0 ring-1 ring-primary/30" />
                          <div className="flex-1 space-y-2 min-w-0">
                            {/* Mode selector */}
                            <div className="flex gap-1 flex-wrap">
                              {[
                                { value: 'prompt_plus_image', label: 'Prompt + Image' },
                                { value: 'image_only', label: 'Image only' },
                              ].map(opt => (
                                <button
                                  key={opt.value}
                                  onClick={() => setReferenceImageMode(opt.value)}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${referenceImageMode === opt.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                            {/* Purpose selector */}
                            <div className="flex gap-1 flex-wrap">
                              {['general', 'pose', 'background', 'lighting', 'composition', 'placement'].map(p => (
                                <button
                                  key={p}
                                  onClick={() => setReferenceImagePurpose(p)}
                                  className={`px-2 py-0.5 rounded-md text-[10px] transition-colors capitalize ${referenceImagePurpose === p ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                                >
                                  {p}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <p className="text-[10px] text-muted-foreground/60 -mt-1">Type a description, upload a reference image, or both — or tap ✨ to auto-generate a prompt</p>

                    {generateError && <p className="text-xs text-destructive">{generateError}</p>}
                    <button
                      onClick={() => handleGenerate(generationTab === "user" ? "user" : "character")}
                      disabled={(!prompt.trim() && !selectedLocation && !referenceImageUrl) || isGenerating}
                      className="sticky bottom-0 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 mt-auto"
                    >
                      {isGenerating ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                      ) : (
                        <><Sparkles className="w-4 h-4" /> Generate & Send</>
                      )}
                    </button>
                  </div>
                )}

                {/* Image grid — below generator */}
                <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
                  {images.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No images shared yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {images.map((img, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="group relative overflow-hidden rounded-xl aspect-square cursor-pointer"
                        >
                          {/* Click the image itself to open full viewer */}
                          <img
                            src={img.url}
                            alt={`${img.senderName}'s photo`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            onClick={() => setSelectedImage(img)}
                          />
                          {/* Action buttons at the bottom — only appear on hover, separate from image click */}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {img.senderType === "character" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setRegenTarget(img); }}
                                className="p-1.5 rounded-full bg-white/20 text-white hover:bg-white/40 transition-colors"
                                title="Regenerate"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {onDeleteImage && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteImage(img.id); }}
                                className="p-1.5 rounded-full bg-destructive/80 text-white hover:bg-destructive transition-colors"
                                title="Delete"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Full image viewer */}
      {createPortal(
        <AnimatePresence>
          {selectedImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/95 z-[55] flex flex-col items-center justify-center p-4"
              onClick={() => setSelectedImage(null)}
            >
              <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{selectedImage.senderName}</p>
                <button onClick={() => setSelectedImage(null)} className="p-2 hover:bg-secondary rounded-lg transition-colors">
                  <X className="w-5 h-5 text-foreground" />
                </button>
              </div>
              <div className="flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
                <img
                  src={selectedImage.url}
                  alt="Full view"
                  className="max-w-full max-h-[75vh] object-contain rounded-xl"
                />
                <div className="flex gap-3">
                  {selectedImage.senderType === "character" && (
                    <button
                      onClick={() => { setRegenTarget(selectedImage); setSelectedImage(null); }}
                      className="px-4 py-2 rounded-lg bg-secondary border border-border text-foreground hover:border-primary/40 transition-colors flex items-center gap-2 text-sm"
                    >
                      <RefreshCw className="w-4 h-4" /> Regenerate
                    </button>
                  )}
                  {onDeleteImage && (
                    <button
                      onClick={() => { onDeleteImage(selectedImage.id); setSelectedImage(null); }}
                      className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center gap-2 text-sm"
                    >
                      <X className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Regenerate reason modal */}
      <RegenerateImageModal
        isOpen={!!regenTarget}
        onClose={() => setRegenTarget(null)}
        onSelect={handleRegenSelect}
        isRegenerating={isRegenerating}
        originalPrompt={regenTarget ? (messages.find(m => m.id === regenTarget.id)?.generation_context?.prompt || null) : null}
      />
    </>
  );
}