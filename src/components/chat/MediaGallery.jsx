import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Images, X, Sparkles, Loader2, RefreshCw, Upload, Wand2, MapPin, ChevronDown, Users, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { fetchUnifiedRoster, getInitial } from "@/lib/unifiedRosterUtils";
import { generateImageWithUserIdentity, buildUserAppearanceData, buildUserReferenceImages } from "@/lib/userImageGeneration";
import RegenerateImageModal from "@/components/chat/RegenerateImageModal";

export default function MediaGallery({ messages, onDeleteImage, character, conversationId, onImageGenerated }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [regenTarget, setRegenTarget] = useState(null); // { id, url } of image to regenerate
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [generationTab, setGenerationTab] = useState("character"); // "character" | "user"

  // Prompt generator state
  const [prompt, setPrompt] = useState("");
  const [referenceImageUrl, setReferenceImageUrl] = useState(null);
  const [referenceImageSource, setReferenceImageSource] = useState(null); // 'upload' | 'gallery'
  const [showGridPicker, setShowGridPicker] = useState(false);
  const [isUploadingRef, setIsUploadingRef] = useState(false);
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
  useEffect(() => {
    if (!isOpen || !userEmail) return;
    Promise.all([
      base44.functions.invoke('fetchAllLocationsForUser', {})
        .then(res => setLocations(res?.data?.locations || []))
        .catch(() => {}),
      base44.entities.UserSettings.list()
        .then(settings => setUserSettings(settings?.[0] || null))
        .catch(() => {}),
      fetchUnifiedRoster(base44, userEmail)
        .then(roster => {
          // Include ALL active characters in the list for selection
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

  const handleRegenSelect = async (reason, customPrompt) => {
    if (!regenTarget) return;
    setIsRegenerating(true);
    try {
      await base44.functions.invoke('regenerateImageWithReason', {
        messageId: regenTarget.id,
        reason,
        customPrompt,
      });
    } finally {
      setIsRegenerating(false);
      setRegenTarget(null);
    }
  };

  const extractMentionedPeople = (text) => {
    if (!text.trim()) return { characters: [], userIncluded: false };
    
    const textLower = text.toLowerCase();
    const mentionedCharacters = allCharacters.filter(c => 
      textLower.includes(c.name.toLowerCase())
    );
    
    const userIncluded = userSettings?.fictional_world_name && 
      textLower.includes(userSettings.fictional_world_name.toLowerCase());
    
    return { characters: mentionedCharacters, userIncluded };
  };

  const buildReferenceImagesFromMention = (mentionedCharacters, userIncluded) => {
    const refs = [];
    
    // Add character avatars
    mentionedCharacters.forEach(char => {
      if (char.avatar_url) refs.push(char.avatar_url);
      if (char.reference_image_urls?.length > 0) {
        refs.push(...char.reference_image_urls.slice(0, 1));
      }
    });
    
    // Add user avatar if included (placeholder since we don't have user avatar)
    if (userIncluded && userSettings?.generated_avatar_urls?.[0]) {
      refs.push(userSettings.generated_avatar_urls[0]);
    }
    
    return refs;
  };

  const handleGenerateCharacter = async () => {
    if ((!prompt.trim() && !referenceImageUrl && !selectedLocation) || !character || !conversationId) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const charName = character.name;
      const charDesc = [character.appearance_notes, character.personality_summary, character.age_range, character.gender].filter(Boolean).join(', ');
      
      // Use selected entities (including world people) from dropdown, or extract from prompt
      let selectedChars = selectedCharacterIds.length > 0
        ? allCharacters.filter(c => selectedCharacterIds.includes(c.id) && c.id !== "user" && !c.is_world_person)
        : extractMentionedPeople(prompt).characters;
      
      let selectedWorldPeople = selectedCharacterIds.length > 0
        ? allCharacters.filter(c => selectedCharacterIds.includes(c.id) && c.is_world_person)
        : [];
      
      const userIncluded = selectedCharacterIds.length > 0
        ? selectedCharacterIds.includes("user")
        : extractMentionedPeople(prompt).userIncluded;
      
      // Build reference images from selected characters + world people
      let charReferenceImages = buildReferenceImagesFromMention(selectedChars, userIncluded);
      
      // Add world people avatars if they exist
      selectedWorldPeople.forEach(person => {
        if (person.avatar_url) charReferenceImages.push(person.avatar_url);
      });
      
      // If no one selected/mentioned, fall back to character's own avatars
      if (charReferenceImages.length === 0 && selectedChars.length === 0 && selectedWorldPeople.length === 0 && !userIncluded) {
        if (character.avatar_url) charReferenceImages.push(character.avatar_url);
        if (character.reference_image_urls?.length > 0) charReferenceImages.push(...character.reference_image_urls.slice(0, 3));
      }
      
      if (referenceImageUrl) charReferenceImages.push(referenceImageUrl);
      
      // Build user reference images with strong identity preservation
      const userChar = allCharacters.find(c => c.is_user);
      let userReferenceImages = [];
      if (userChar) {
        // Prioritize uploaded reference images for user identity
        if (userChar.reference_image_urls?.length > 0) {
          userReferenceImages.push(...userChar.reference_image_urls.slice(0, 3));
        }
        // Then add generated avatars
        if (userChar.generated_avatar_urls?.length > 0) {
          userReferenceImages.push(...userChar.generated_avatar_urls.slice(0, 2));
        }
        // Finally add primary avatar as fallback
        if (userChar.avatar_url && !userReferenceImages.includes(userChar.avatar_url)) {
          userReferenceImages.push(userChar.avatar_url);
        }
      }

      const promptText = prompt.trim() || "candid natural moment, everyday life";

      // Create a placeholder message then call generateImageAsync (which handles location locking)
      const newMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: "character",
        character_id: character.id,
        character_name: character.name,
        content: "",
        emotional_state: character.emotional_state || "calm",
        timestamp: new Date().toISOString(),
      });

      if (!newMsg?.id) throw new Error('Failed to create message');

      // Build the prompt for generateImageAsync
      const fullPrompt = `[CHARACTER] ${promptText}`;

      // Call generateImageAsync which handles location locking, character refs, etc.
      const genRes = await base44.functions.invoke('generateImageAsync', {
        messageId: newMsg.id,
        prompt: fullPrompt,
        characterReferenceImages: charReferenceImages,
        userReferenceImages: userReferenceImages,
        characterName: charName,
        subjectType: "character",
        characterId: character.id,
        manualLocationId: selectedLocation?.id || null,
        manualZoneId: selectedZone || null,
        includesUser: userIncluded,
        userAppearanceData: userIncluded ? {
          appearance_notes: userChar?.appearance_notes || '',
          age_range: userChar?.age_range || '',
          gender: userChar?.gender || '',
          ethnicities: userChar?.ethnicities || [],
        } : null,
      });

      if (genRes?.data?.filtered) {
        await base44.entities.Message.delete(newMsg.id).catch(() => {});
        throw new Error('Image blocked by content filter. Try a different description.');
      }

      if (!genRes?.data?.imageUrl) {
        await base44.entities.Message.delete(newMsg.id).catch(() => {});
        throw new Error('No image URL returned');
      }

      // Store memory so character remembers sending this
      const envNote = selectedLocation ? ` at ${selectedLocation.name}${selectedZone ? ` (${selectedZone})` : ''}` : '';
      base44.entities.Memory.create({
        character_id: character.id,
        title: `Sent a photo: ${promptText.substring(0, 60)}`,
        description: `You sent the user a photo${envNote}. Prompt: "${promptText}".`,
        emotional_impact: 'positive',
        timestamp: new Date().toISOString(),
        source_context: `gallery_generated_${newMsg.id}`,
      }).catch(() => {});

      setPrompt("");
      setReferenceImageUrl(null);
      setReferenceImageSource(null);
      setShowGridPicker(false);
      setIsOpen(false);
      if (onImageGenerated) onImageGenerated(newMsg);
    } catch (err) {
      setGenerateError(err.message || "Failed to generate image");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateUser = async () => {
    if ((!prompt.trim() && !selectedLocation) || !character || !conversationId) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const userName = userSettings?.fictional_world_name || "the user";
      const promptText = prompt.trim() || "candid natural moment, everyday life";

      // Use selected entities from dropdown (excluding user and world people for user generation)
      const selectedChars = selectedCharacterIds.length > 0
        ? allCharacters.filter(c => selectedCharacterIds.includes(c.id) && c.id !== "user" && !c.is_world_person)
        : extractMentionedPeople(promptText).characters;
      
      // Build reference images with selected/mentioned characters
      const charReferences = buildReferenceImagesFromMention(selectedChars, false);
      
      // Get user profile for identity-locked generation
      const userChar = allCharacters.find(c => c.is_user);
      const userAppearanceData = buildUserAppearanceData(userChar);

      // Create a placeholder message for user
      const newMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: "user",
        content: "",
        timestamp: new Date().toISOString(),
      });

      if (!newMsg?.id) throw new Error('Failed to create message');

      try {
        // Use shared user identity-preserving generation (same as Travel page)
        const imageUrl = await generateImageWithUserIdentity(
          promptText,
          charReferences,
          selectedLocation ? locationImages : [],
          userChar,
          userAppearanceData,
          true // strictMode: enforce maximum identity preservation
        );

        // Update message with generated image
        await base44.entities.Message.update(newMsg.id, {
          image_url: imageUrl,
          generation_context: {
            prompt: promptText,
            subject_type: "user",
            character_id: character.id,
            character_reference_images: charReferences,
            location_id: selectedLocation?.id || null,
            zone_name: selectedZone || null,
            location_name: selectedLocation?.name || null,
            location_reference_images: selectedLocation ? locationImages : [],
            user_reference_images: userChar ? buildUserReferenceImages(userChar) : [],
            user_appearance_data: userAppearanceData,
            is_user_identity_locked: true,
          },
        });

        setPrompt("");
        setReferenceImageUrl(null);
        setShowGridPicker(false);
        setIsOpen(false);
        if (onImageGenerated) onImageGenerated(newMsg);
      } catch (genErr) {
        await base44.entities.Message.delete(newMsg.id).catch(() => {});
        throw genErr;
      }
    } catch (err) {
      setGenerateError(err.message || "Failed to generate image");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      {/* Media button in header — always show if character exists */}
      <button
        onClick={() => setIsOpen(true)}
        className="relative p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="View media & generate photos"
      >
        <Images className="w-4 h-4" />
        {images.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
            {images.length}
          </span>
        )}
      </button>

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
                        {userSettings?.fictional_world_name || "You"}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <p className="text-sm font-medium text-foreground">
                        {generationTab === "character" ? `Generate a photo from ${character.name}` : `Generate a photo of ${userSettings?.fictional_world_name || "you"}`}
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

                    {/* Reference image — upload or pick from gallery */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="flex-shrink-0 cursor-pointer flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                          <input type="file" accept="image/*" className="hidden" onChange={handleRefUpload} disabled={isUploadingRef} />
                          {isUploadingRef ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                          Upload ref
                        </label>
                        {images.length > 0 && (
                          <button
                            onClick={() => setShowGridPicker(v => !v)}
                            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                          >
                            <Images className="w-3.5 h-3.5" />
                            Pick from gallery
                          </button>
                        )}
                        {referenceImageUrl && (
                          <div className="relative flex-shrink-0">
                            <img src={referenceImageUrl} alt="reference" className="w-10 h-10 rounded-lg object-cover ring-2 ring-primary/40" />
                            <button
                              onClick={clearReference}
                              className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full flex items-center justify-center"
                            >
                              <X className="w-2.5 h-2.5 text-white" />
                            </button>
                          </div>
                        )}
                      </div>
                      {!referenceImageUrl && <p className="text-[10px] text-muted-foreground/60">Optional: upload or pick an existing photo to guide the scene/style</p>}
                      {referenceImageUrl && <p className="text-[10px] text-primary/70">Reference set from {referenceImageSource === 'gallery' ? 'gallery' : 'upload'} — will influence the result</p>}

                      {/* Inline gallery picker */}
                      {showGridPicker && images.length > 0 && (
                        <div className="grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto">
                          {images.map((img, i) => (
                            <button
                              key={i}
                              onClick={() => handlePickFromGallery(img)}
                              className={`relative aspect-square rounded-lg overflow-hidden ring-2 transition-all ${referenceImageUrl === img.url ? 'ring-primary' : 'ring-transparent hover:ring-primary/40'}`}
                            >
                              <img src={img.url} alt="" className="w-full h-full object-cover" />
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
                        placeholder={`Describe a scene... or click ✨ to auto-generate`}
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
                    <p className="text-[10px] text-muted-foreground/60 -mt-1">Type a description, upload a reference, or both — or tap ✨ to auto-generate a prompt</p>

                    {generateError && <p className="text-xs text-destructive">{generateError}</p>}
                    <button
                      onClick={generationTab === "character" ? handleGenerateCharacter : handleGenerateUser}
                      disabled={(!prompt.trim() && !referenceImageUrl && !selectedLocation) || isGenerating}
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