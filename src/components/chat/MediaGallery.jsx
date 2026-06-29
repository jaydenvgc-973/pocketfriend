import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, Loader2, RefreshCw, Wand2, MapPin, ChevronDown, Users, Check, ImagePlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import RegenerateImageModal from "@/components/chat/RegenerateImageModal";
import { useAuth } from "@/lib/AuthContext";
import { validateSelectedPeopleIdentities, buildMultiPersonPayload } from "@/lib/mediaGridIdentityLock";
import { registerUserForegroundTask, clearUserForegroundTask, FOREGROUND_TASKS, PRIORITY_LEVELS } from "@/lib/foregroundPriority";
import { readCache, writeCache, isCacheStale, isValidLocationList } from "@/lib/mediaGridCache";

function getInitial(name) { return name?.[0]?.toUpperCase() || '?'; }

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
  const { user } = useAuth();
  const foregroundTaskIdRef = useRef(null);

  // Initialize open immediately if mounted with externalTrigger=true.
  // This prevents a race where onExternalClose() resets the parent flag before
  // isOpen has committed, which would unmount the component before it renders.
  const [isOpen, setIsOpen] = useState(!!externalTrigger);

  useEffect(() => {
    if (externalTrigger) setIsOpen(true);
  }, [externalTrigger]);

  // Clear image cache only when the conversation changes — not on every close.
  // This prevents a 500-message re-fetch every time the gallery is toggled open/closed.
  const prevConversationIdRef = useRef(conversationId);
  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      prevConversationIdRef.current = conversationId;
      setAllImages([]);
    }
  }, [conversationId]);
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

  // Load status for character dropdown — drives visible error/retry UI
  // 'loading' | 'fresh' | 'error'
  const [charsLoadStatus, setCharsLoadStatus] = useState('loading');
  const [locsLoadStatus, setLocsLoadStatus] = useState('loading');
  // Diagnostics for the character dropdown failure panel
  const [charsDiagnostics, setCharsDiagnostics] = useState(null);

  // Get current user's email — resolved once on mount, not gated on isOpen
  const [userEmail, setUserEmail] = useState(null);
  const userEmailRef = useRef(null);

  // ── SESSION USER REF CACHE ────────────────────────────────────────────────
  // Once user refs are successfully resolved (from any source), store them here
  // for the entire Media Grid session. Never cleared by prompt changes, location
  // changes, or generation completion. Only cleared when the modal fully unmounts.
  // This prevents the false "No user reference images found" error after a
  // successful user-image generation in the same session.
  const sessionUserRefsRef = useRef([]); // string[] — last-known-good user ref URLs

  useEffect(() => {
    base44.auth.me()
      .then(user => {
        if (user?.email) {
          userEmailRef.current = user.email;
          setUserEmail(user.email);
        }
      })
      .catch(() => {});
  }, []);

  // Track whether dropdown data has been loaded for the current open session
  const dropdownLoadedRef = useRef(false);

  // Manual retry — bumping this counter re-triggers the load effect
  const [retryCount, setRetryCount] = useState(0);

  // Load dropdowns (characters + locations + settings) when the modal opens.
  //
  // STRATEGY — last-known-good cache + background refresh + visible failure states:
  //   1. Register foreground task immediately (background systems yield).
  //   2. Read localStorage cache scoped by owner_email — show instantly if valid.
  //   3. If cache is fresh (<10 min), skip server fetch for that data type.
  //   4. If cache is stale or missing, fetch from server in parallel.
  //   5. Write server results to cache ONLY if they are complete and valid.
  //   6. Never overwrite good cache with empty/partial/failed results.
  //   7. If both cache and server fail or return empty → set status to 'error' (visible retry).
  //   8. If server returns user-only roster → keep existing cache, set status to 'user_only' (visible warning).
  //
  // CRITICAL: All queries use owner_email — never created_by, never unscoped.
  useEffect(() => {
    if (!isOpen) {
      dropdownLoadedRef.current = false;
      return;
    }

    const email = userEmailRef.current || userEmail;
    if (!email) return; // Re-fires once userEmail state updates

    if (dropdownLoadedRef.current) return;
    dropdownLoadedRef.current = true;

    // Reset statuses to loading while we figure out what to show
    setCharsLoadStatus('loading');
    setLocsLoadStatus('loading');

    // Register foreground priority — background simulations yield
    const email2 = userEmailRef.current || userEmail;
    const mediaTaskId = email2
      ? registerUserForegroundTask(FOREGROUND_TASKS.MEDIA_GRID, { ownerEmail: email2, priority: PRIORITY_LEVELS.HIGH, durationMs: 15000 })
      : null;
    const releaseForeground = () => { if (email2 && mediaTaskId) clearUserForegroundTask(email2, mediaTaskId); };

    // ── STEP 1: Show last-known-good cache immediately ──────────────────────
    // Only the owner-scoped mg_cache is a valid seed — no lfc, no cross-account fallback.
    const cachedLocs = readCache(email, 'locations');

    if (cachedLocs) {
      setLocations(cachedLocs.records);
      setLocsLoadStatus('cache');
    }

    const locsFresh = cachedLocs && !isCacheStale(cachedLocs);

    // ── STEP 2: Fetch characters + settings + locations from server ──────────
    // SOURCE OF TRUTH: Direct account-scoped Character.filter({ owner_email: email }).
    // No unified roster. No cache seeding. No cross-account paths.
    const refreshPromises = [];

    // Always fetch fresh characters — direct account-scoped query only
    refreshPromises.push(
      Promise.all([
        base44.entities.UserSettings.filter({ owner_email: email }).catch(() => []),
        base44.entities.Character.filter({ owner_email: email }, '-created_date', 200).catch(() => []),
        base44.entities.User.filter({ email }).catch(() => []),
      ]).then(([settingsList, chars, userEntityList]) => {
        const settings = settingsList?.[0] || null;
        setUserSettings(settings);

        // User entity is the authoritative source for reference images and avatar.
        // UserSettings is used only for world name and as a legacy fallback for images.
        const userEntity = userEntityList?.[0] || null;

        // Filter to live characters only — never show deleted/merged
        const liveChars = chars.filter(c =>
          c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
        );

        // Build user entry — User entity is authoritative for images; UserSettings for world name
        const userWorldName = settings?.fictional_world_name || email.split('@')[0] || 'Me';

        // Avatar priority: User.reference_image_urls[0] → User.generated_avatar_urls[0] →
        //   User.avatar_url → UserSettings fallbacks → null
        const userAvatarUrl =
          userEntity?.reference_image_urls?.[0] ||
          userEntity?.generated_avatar_urls?.[0] ||
          userEntity?.avatar_url ||
          settings?.generated_avatar_urls?.[0] ||
          settings?.reference_image_urls?.[0] ||
          null;

        // Reference images for generation — User entity first, UserSettings as fallback
        const userRefImageUrls = [
          ...(userEntity?.reference_image_urls || []),
          ...(userEntity?.generated_avatar_urls || []),
          ...(userEntity?.avatar_url ? [userEntity.avatar_url] : []),
          ...(settings?.reference_image_urls || []),
          ...(settings?.generated_avatar_urls || []),
        ].filter(Boolean);

        const userEntry = {
          id: '__user__',
          name: userWorldName,
          world_name: userWorldName,
          avatar_url: userAvatarUrl,
          reference_image_urls: userRefImageUrls,
          is_user: true,
          owner_email: email,
        };

        console.log(
          `[MediaGallery] User entry built | world_name="${userWorldName}"` +
          ` | avatar_source=${userEntity?.reference_image_urls?.[0] ? 'user_entity_ref' : userEntity?.generated_avatar_urls?.[0] ? 'user_entity_gen_avatar' : userEntity?.avatar_url ? 'user_entity_avatar' : 'settings_fallback'}` +
          ` | ref_count=${userRefImageUrls.length}`
        );

        // Active first (desc by created_date), then inactive
        const activeChars = liveChars
          .filter(c => c.is_active_character)
          .sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
        const inactiveChars = liveChars
          .filter(c => !c.is_active_character)
          .sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));

        const roster = [userEntry, ...activeChars, ...inactiveChars];

        setAllCharacters(roster);
        // Write to mg_cache for same-session reuse in RegenerateImageModal
        writeCache(email, 'characters', roster);
        setCharsLoadStatus('fresh');
        setCharsDiagnostics({
          owner_email: email,
          source: 'direct_account_query',
          character_count: liveChars.length,
          loaded_at: new Date().toISOString(),
        });
      }).catch(err => {
        console.error('[MediaGallery] Character/settings load failed:', err?.message);
        setCharsLoadStatus('error');
        setCharsDiagnostics({ owner_email: email, error: err?.message });
      })
    );

    if (!locsFresh) {
      refreshPromises.push(
        base44.functions.invoke('fetchAllLocationsForUser', {})
          .then(res => {
            const locs = res?.data?.locations;
            if (isValidLocationList(locs)) {
              setLocations(locs);
              writeCache(email, 'locations', locs);
              setLocsLoadStatus('fresh');
            } else {
              // Empty or invalid — keep cache if available, otherwise error
              if (!cachedLocs) setLocsLoadStatus('error');
              else setLocsLoadStatus('cache');
              console.warn('[MediaGallery] Location list returned empty — preserving existing cache.');
            }
          })
          .catch(err => {
            console.error('[MediaGallery] Location list fetch failed:', err?.message);
            setLocsLoadStatus(cachedLocs ? 'cache' : 'error');
          })
      );
    } else {
      setLocsLoadStatus('fresh');
    }

    // Settings is always refreshed (small payload, non-blocking)
    refreshPromises.push(
      base44.entities.UserSettings.filter({ owner_email: email })
        .then(s => setUserSettings(s?.[0] || null))
        .catch(() => {})
    );

    Promise.all(refreshPromises).finally(() => releaseForeground());
  }, [isOpen, userEmail, retryCount]);

  // Retry handler — clears the session lock so the effect re-runs cleanly
  const handleDropdownRetry = () => {
    dropdownLoadedRef.current = false;
    setRetryCount(c => c + 1);
  };

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

  // ── MEDIA GALLERY SOURCE: fetches up to 500 recent message records from the DB when gallery opens.
  // This is a capped retrieval — not full historical coverage of all messages in the conversation.
  // Images from messages older than the 500-record cap are not guaranteed to appear here.
  // This cap is independent of the 200-message visible chat render window.
  // Images outside the render window but within the 500-record cap will still appear in the gallery.
  // No images are deleted — only the retrieval depth is capped for performance.
  const [allImages, setAllImages] = useState([]);
  const [isFetchingImages, setIsFetchingImages] = useState(false);

  useEffect(() => {
    if (!isOpen || !conversationId) return;
    // Stagger the heavy 500-message image scan by 800ms so the dropdown data (characters +
    // locations) always resolves and renders first. The user sees the generator UI immediately.
    const timer = setTimeout(() => {
      setIsFetchingImages(true);
      base44.entities.Message.filter(
        { conversation_id: conversationId },
        "-created_date",
        500
      )
        .then(msgs => {
          const imgs = (msgs || [])
            .filter(m => m.image_url)
            .map(m => ({
              id: m.id,
              url: m.image_url,
              senderType: m.sender_type,
              senderName: m.character_name || "You",
              timestamp: m.timestamp || m.created_date,
            }))
            .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
          setAllImages(imgs);
        })
        .catch(() => {})
        .finally(() => setIsFetchingImages(false));
    }, 800);
    return () => clearTimeout(timer);
  }, [isOpen, conversationId]);

  // Also merge in any new images from the current feed (real-time arrivals not yet in DB fetch)
  const feedImages = messages
    .filter(msg => msg.image_url)
    .map(msg => ({
      id: msg.id,
      url: msg.image_url,
      senderType: msg.sender_type,
      senderName: msg.character_name || "You",
      timestamp: msg.timestamp || msg.created_date,
    }));

  // Merge: DB images + any feed images not already in DB result (dedup by id)
  const dbImageIds = new Set(allImages.map(i => i.id));
  const freshFeedImages = feedImages.filter(i => !dbImageIds.has(i.id));
  const images = [...freshFeedImages, ...allImages]
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  const handleRegenSelect = async (reason, customPrompt, manualLocationId = null, manualZoneId = null, directLocationImages = null, directLocationName = null, intendedSubjects = null) => {
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
        // For no_avatar: the explicitly selected intended subjects override auto-resolved identity
        intendedSubjectIds: intendedSubjects?.intendedSubjectIds || null,
        includeUserSubject: intendedSubjects?.includeUser || false,
        // User reference images passed from subject picker — prevents generic person substitution
        userRefImages: intendedSubjects?.userRefImages || null,
        userName: intendedSubjects?.userName || null,
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

  // ── SELECTED IDENTITY MAP BUILDER ─────────────────────────────────────────
  // Builds a map from every name form (full, first, display, aliases) to the selected
  // character record. Used to enrich the prompt before generation so typed short names
  // ("Henry") resolve to the explicitly selected character ("Henry Billion").
  //
  // CONTRACT: only call with characters that are already in selectedCharacterIds.
  // Never used for roster-wide name matching — only the user's active selection.
  const buildSelectedIdentityMap = (selectedCharRecords) => {
    const normalize = (s) => (s || '').toLowerCase().trim();
    const map = new Map(); // normalized name → character record

    for (const char of selectedCharRecords) {
      if (!char) continue;

      // Full name
      if (char.name) map.set(normalize(char.name), char);

      // First name (first word of name)
      const firstName = (char.name || '').split(/\s+/)[0];
      if (firstName && firstName.length > 1) map.set(normalize(firstName), char);

      // display_name / primary_name if different
      if (char.display_name && char.display_name !== char.name) map.set(normalize(char.display_name), char);
      if (char.primary_name && char.primary_name !== char.name) map.set(normalize(char.primary_name), char);

      // nickname_for_user
      if (char.nickname_for_user) map.set(normalize(char.nickname_for_user), char);

      // Aliases array — each alias object has a .name or .alias field
      const aliases = char.aliases || [];
      for (const a of aliases) {
        const aliasText = typeof a === 'string' ? a : (a.name || a.alias || '');
        if (aliasText) map.set(normalize(aliasText), char);
      }
    }

    return map;
  };

  // ── NAME REFERENCE KEY INJECTOR ────────────────────────────────────────────
  // Given the user's raw prompt and a selectedIdentityMap, returns an enriched
  // prompt that prepends a "NAME REFERENCE KEY" section so the AI model knows
  // exactly which selected character each short name refers to.
  //
  // Example output:
  //   [NAME REFERENCE KEY — SELECTED CHARACTERS]
  //   "Henry" = Henry Billion (ID: abc123) — use their identity references
  //   "Ethan" = Ethan Thompson (ID: def456) — use their identity references
  //   [END NAME REFERENCE KEY]
  //   Henry at the gym, smiling
  //
  // RULES:
  //   - Only injected when there are actually selected characters (not for tab-only generation)
  //   - Only injects for characters who appear in the prompt by any name form
  //   - If a name has ambiguous matches (two selected chars share a first name), uses full names
  //   - Does NOT rewrite the prompt — only prepends the key block
  // userParticipant = { name, id } for the selected user world-self, or null.
  // `id` MUST be the canonical authenticated user ID (user.id) — never the '__user__'
  // placeholder, never hardcoded. The selected user is a visual participant exactly like
  // any selected character and must appear in the Name Reference Key with their user ID.
  const injectNameReferenceKey = (rawPrompt, selectedIdentityMap, selectedCharRecords, userParticipant = null) => {
    // Gate: only inject when there are selected characters OR a selected user participant.
    if ((!selectedIdentityMap || selectedIdentityMap.size === 0) && !userParticipant) return rawPrompt;

    const promptLower = rawPrompt.toLowerCase();
    const referenced = new Set(); // char IDs that appear in the prompt
    const keyLines = [];
    let userInjected = false;

    // Check first-name ambiguity: if two selected chars have the same first name, skip first-name
    // resolution for those and rely on full name or explicit user selection
    const firstNameCount = new Map();
    for (const char of selectedCharRecords) {
      const firstName = (char.name || '').split(/\s+/)[0].toLowerCase();
      if (firstName) firstNameCount.set(firstName, (firstNameCount.get(firstName) || 0) + 1);
    }

    for (const char of selectedCharRecords) {
      if (!char?.name) continue;

      const firstName = (char.name || '').split(/\s+/)[0];
      const isAmbiguousFirstName = (firstNameCount.get(firstName.toLowerCase()) || 0) > 1;

      // Determine all name forms to check in prompt
      const nameForms = [
        char.name,
        !isAmbiguousFirstName ? firstName : null, // skip ambiguous first names
        char.display_name,
        char.primary_name,
        char.nickname_for_user,
        ...(char.aliases || []).map(a => typeof a === 'string' ? a : (a.name || a.alias || '')),
      ].filter(Boolean);

      const appearsInPrompt = nameForms.some(n => promptLower.includes(n.toLowerCase()));
      if (appearsInPrompt && !referenced.has(char.id)) {
        referenced.add(char.id);
        keyLines.push(`"${firstName}" = ${char.name} (ID: ${char.id}) — use their visual identity references`);
      }
    }

    // ── SELECTED USER (world persona) ──────────────────────────────────────
    // The selected user is a visual participant just like any selected character.
    // Inject them into the Name Reference Key with their CANONICAL USER ID so the
    // model grounds the user's identity references.
    if (userParticipant && userParticipant.name && userParticipant.id) {
      const userName = userParticipant.name;
      const userNameForms = [userName, ...(userParticipant.aliases || [])].filter(Boolean);
      const userAppearsInPrompt = userNameForms.some(n => n && n.length >= 3 && promptLower.includes(n.toLowerCase()));
      if (userAppearsInPrompt) {
        keyLines.push(`"${userName}" = ${userName} (USER ID: ${userParticipant.id}) — use their visual identity references`);
        userInjected = true;
      }
    }

    // If none of the selected characters appear by name in the prompt, still inject all of them
    // so the model knows the full cast. This handles prompts like "at the gym smiling" where
    // no name is mentioned but a character is explicitly selected.
    if (referenced.size === 0 && selectedCharRecords.length > 0) {
      for (const char of selectedCharRecords) {
        if (!char?.name) continue;
        const firstName = (char.name || '').split(/\s+/)[0];
        keyLines.push(`"${char.name}" is a selected subject — use their visual identity references`);
      }
    }

    // If the user is selected but their name did not appear in the prompt, still inject them.
    // The user is an explicit selection — they must always be in the key when selected.
    if (userParticipant && userParticipant.name && userParticipant.id && !userInjected) {
      keyLines.push(`"${userParticipant.name}" = ${userParticipant.name} (USER ID: ${userParticipant.id}) — use their visual identity references`);
    }

    if (keyLines.length === 0) return rawPrompt;

    // When the user is a selected participant, the key covers BOTH characters and the user.
    // Use "SELECTED PARTICIPANTS" so the wording never implies characters-only.
    const header = userParticipant
      ? `[NAME REFERENCE KEY — SELECTED PARTICIPANTS]`
      : `[NAME REFERENCE KEY — SELECTED CHARACTERS]`;
    const keyBlock = `${header}\n${keyLines.join('\n')}\n[END NAME REFERENCE KEY]\n`;
    return keyBlock + rawPrompt;
  };

  // ── SHARED GENERATE HANDLER ────────────────────────────────────────────────
  // Source-of-truth model: use exactly what the user selected. No guessing.
  const handleGenerate = async (subjectType) => {
    if (!character || !conversationId) return;

    // SUBJECT VALIDATION: Subjects are optional — non-character images (location, object, document,
    // crowd, scenery) are valid with zero subjects selected. If subjects are selected, they are
    // required visual participants. If no subjects and no prompt, require at least a prompt.
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

    // If no subjects are selected AND subjectType is not 'user', this is a non-character image.
    // Non-character images (objects, documents, locations, crowds, scenery) are fully valid.
    // Require at least a prompt text for non-character generation.
    const isNonCharacterMode = selectedCharacterIds.length === 0 && subjectType !== 'user';
    if (isNonCharacterMode) {
      if (!promptText.trim() || promptText === 'candid natural moment, everyday life') {
        setGenerateError('Describe what you want to generate — a location, object, document, crowd, or scene.');
        return;
      }
    }

    // Resolve world-self character early — needed for validation hints and user ref building below
    const userChar = allCharacters.find(c => c.is_user);

    // Pre-compute subject selection shape — used throughout the routing logic below.
    const hasMultipleSubjectsSelected = selectedCharacterIds.length > 1;
    const hasSingleNonUserSubject = selectedCharacterIds.length === 1 &&
      !allCharacters.find(c => c.id === selectedCharacterIds[0])?.is_user;
    const hasSingleUserSubject = selectedCharacterIds.length === 1 &&
      !!(allCharacters.find(c => c.id === selectedCharacterIds[0])?.is_user);
    const hasNoSubjects = selectedCharacterIds.length === 0;

    if (selectedCharacterIds.length > 0 && !hasSingleUserSubject) {
      // Multi-person image: validate all selected people (excluding user-self characters)
      const nonUserIds = selectedCharacterIds.filter(id => !allCharacters.find(c => c.id === id)?.is_user);
      // CRITICAL FIX: includeUser must be true when the user world-self IS in the selection.
      // Previously hardcoded false — caused user identity to be excluded from multi-person payload.
      const userIsSelected = selectedCharacterIds.some(id => allCharacters.find(c => c.id === id)?.is_user);
      const validation = await validateSelectedPeopleIdentities(
        base44,
        nonUserIds,
        userIsSelected, // true when user world-self is explicitly in selectedCharacterIds
        userEmail,
        character.id,
        allCharacters,
        // Pass session cache + selector avatar so validation never produces a false "missing" error
        {
          sessionCacheRefs: sessionUserRefsRef.current,
          selectorAvatarUrl: userChar?.avatar_url || null,
        }
      );

      if (!validation.valid) {
        setGenerateError(validation.errors.join('\n'));
        return;
      }
      selectedPeople = validation.selectedPeople;
      console.log(`[MediaGallery] Identity lock PASSED for ${selectedCharacterIds.length} selected people`);
    } else if (hasSingleUserSubject) {
      console.log(`[MediaGallery] User-self only selected — routing as user-only`);
    }
    // If no multi-select, use single-character mode (existing path)

    // Build user refs — SESSION-CACHED PRIORITY ORDER:
    // 1. sessionUserRefsRef (last-known-good from this Media Grid session — never cleared mid-session)
    // 2. UserSettings.reference_image_urls (fresh DB)
    // 3. UserSettings.generated_avatar_urls (fresh DB)
    // 4. Selector list avatar_url for the world-self character (visible in picker = valid identity ref)
    // 5. world-self Character.avatar_url
    //
    // RULE: If any source resolves refs, store them in sessionUserRefsRef immediately.
    // Subsequent generations in the same session always have refs available.
    // isUserOnlyMode must be computed here (before needsUserRefs) even though the routing
    // block repeats it below — this avoids a temporal dead-zone reference error.
    const isUserOnlyModeEarly = (hasNoSubjects && subjectType === 'user') || hasSingleUserSubject;
    const userIsInSubjectSelection = selectedCharacterIds.some(id => allCharacters.find(c => c.id === id)?.is_user);
    const needsUserRefs = isUserOnlyModeEarly || userIsInSubjectSelection;

    let userRefImages = [];
    if (needsUserRefs) {
      // Build fresh candidate list — User entity (via picker row) is authoritative.
      // userChar is the __user__ entry built from User entity data during dropdown load.
      // Fall back to UserSettings fields only when User entity data is absent.
      const freshRefs = [
        ...(userChar?.reference_image_urls || []).slice(0, 3),
        // Selector list image: the avatar_url already shown beside the user in the picker dropdown.
        // If it's visible in the UI, it's a valid identity reference — must be usable.
        userChar?.avatar_url,
        // UserSettings fallback (legacy mirror)
        ...(userSettings?.reference_image_urls || []).slice(0, 3),
        ...(userSettings?.generated_avatar_urls || []).slice(0, 2),
      ].filter(Boolean);

      if (freshRefs.length > 0) {
        // Good resolution — update session cache
        sessionUserRefsRef.current = freshRefs;
        userRefImages = freshRefs;
        console.log(`[MediaGallery] User refs resolved fresh (${freshRefs.length}) — session cache updated`);
      } else if (sessionUserRefsRef.current.length > 0) {
        // Fresh lookup returned empty but session cache has known-good refs — reuse them.
        // This is the fix for the false "missing" error after a successful generation.
        userRefImages = sessionUserRefsRef.current;
        console.log(`[MediaGallery] User refs: fresh lookup empty — using session cache (${sessionUserRefsRef.current.length} refs). This is NOT a missing error.`);
      } else {
        // Truly no refs from any source in this session
        userRefImages = [];
        console.warn(`[MediaGallery] User refs: no refs found from any source (UserSettings, avatar, session cache)`);
      }
    }

    // FIX: Do NOT use avatar_url as the primary reference image.
    // Avatar photos contain background, pose, and lighting that contaminate the generated scene.
    // Use reference_image_urls (real face photos) first. Only fall back to avatar if none exist.
    const refUrls = (character.reference_image_urls || [])
      .filter(url => url && !url.includes('generated_image'))
      .slice(0, 3);
    const charRefImages = refUrls.length > 0
      ? refUrls
      : (character.avatar_url ? [character.avatar_url] : []);

    // ── SUBJECT ROUTING LOGIC ────────────────────────────────────────────────
    // The SENDER tab (character vs user) controls WHO SENDS the image.
    // It does NOT control who appears in the image — that is driven by selectedCharacterIds.

    // isUserOnlyMode: true only when no subjects selected and sender is user,
    // OR when ONLY the user world-self character is selected (solo user selfie).
    const isUserOnlyMode = isUserOnlyModeEarly;

    // Single-character override: when exactly one non-user character is selected,
    // that character is the authoritative subject (overrides the active chat character).
    let resolvedCharacterId = isUserOnlyMode ? null : character.id;
    let resolvedCharacterName = isUserOnlyMode ? null : character.name;
    let resolvedCharRefImages = isUserOnlyMode ? [] : charRefImages;

    if (hasSingleNonUserSubject && !selectedPeople) {
      const resolvedSingleChar = allCharacters.find(c => c.id === selectedCharacterIds[0]) || null;
      if (resolvedSingleChar) {
        resolvedCharacterId = resolvedSingleChar.id;
        resolvedCharacterName = resolvedSingleChar.name;
        const explicitRefs = (resolvedSingleChar.reference_image_urls || [])
          .filter(url => url && !url.includes('generated_image'))
          .slice(0, 3);
        resolvedCharRefImages = explicitRefs.length > 0
          ? explicitRefs
          : (resolvedSingleChar.avatar_url ? [resolvedSingleChar.avatar_url] : []);
        console.log(`[MediaGallery] Single character override: "${resolvedSingleChar.name}" (${resolvedSingleChar.id})`);
      }
    } else if (hasSingleUserSubject) {
      resolvedCharacterId = null;
      resolvedCharacterName = null;
      resolvedCharRefImages = [];
      console.log(`[MediaGallery] Single selection is user world-self — routing as user-only`);
    }

    // effectiveSubjectType: "user" only when truly user-only, otherwise use sender tab value
    // IMPORTANT: When multiple subjects are selected, sender tab is "user" means the image
    // is SENT by the user — it does NOT mean the image contains only the user.
    const effectiveSubjectType = isUserOnlyMode ? 'user' : subjectType;

    // Multi-person payload: built when selectedPeople was validated above.
    // ONLY suppressed when truly user-only (no subjects, or solo user world-self).
    const effectiveMultiPersonSelection = (!isUserOnlyMode && selectedPeople)
      ? buildMultiPersonPayload(selectedPeople, promptText, selectedLocation?.id || null, selectedZone || null)
      : null;

    if (isUserOnlyMode) {
      console.log(`[MediaGallery] USER-ONLY mode — no character subjects. Active chat character "${character.name}" is NOT a subject.`);
    } else if (hasMultipleSubjectsSelected) {
      console.log(`[MediaGallery] MULTI-SUBJECT mode — ${selectedCharacterIds.length} subjects selected. Sender tab="${subjectType}" is SENDER only, not subject filter.`);
    }

    // ── SELECTED IDENTITY NAME RESOLUTION ────────────────────────────────────
    // Build the identity map from all selected character records (not just IDs).
    // This maps every name form (full, first, alias) to the full character record.
    // Used to inject a Name Reference Key into the prompt so typed short names
    // (e.g. "Henry") resolve to the selected character ("Henry Billion"), not a generic person.
    const selectedCharRecords = selectedCharacterIds
      .map(id => allCharacters.find(c => c.id === id))
      .filter(Boolean)
      .filter(c => !c.is_user); // characters only — user world-self handled via userParticipant below

    const selectedIdentityMap = buildSelectedIdentityMap(selectedCharRecords);

    // ── SELECTED USER (world persona) for the Name Reference Key ─────────────
    // When the user world-self is in the selection, build a userParticipant carrying the
    // canonical authenticated user ID (user.id) and the world persona name. This ensures the
    // generated prompt's Name Reference Key includes the user exactly like selected characters.
    const userIsSelectedForGrid = selectedCharacterIds.some(id => allCharacters.find(c => c.id === id)?.is_user);
    const userWorldNameForGrid = userSettings?.fictional_world_name
      || allCharacters.find(c => c.is_user)?.name
      || user?.full_name
      || null;
    const userParticipant = (userIsSelectedForGrid && user?.id && userWorldNameForGrid)
      ? { name: userWorldNameForGrid, id: user.id }
      : null;

    // Enrich the prompt with the Name Reference Key if any characters OR the user is selected.
    // IMPORTANT: This only adds a header block — never rewrites the user's prompt text.
    // The original promptText is preserved as-is for generation_context.prompt (source of truth).
    const enrichedPrompt = (selectedCharRecords.length > 0 || userParticipant)
      ? injectNameReferenceKey(promptText, selectedIdentityMap, selectedCharRecords, userParticipant)
      : promptText;

    if (enrichedPrompt !== promptText) {
      const participantCount = selectedCharRecords.length + (userParticipant ? 1 : 0);
      console.log(`[MediaGallery] Name Reference Key injected for ${participantCount} selected participant(s)`);
      selectedCharRecords.forEach(c => console.log(`  → ${c.name} (ID: ${c.id})`));
      if (userParticipant) console.log(`  → ${userParticipant.name} (USER ID: ${userParticipant.id})`);
    }

    // For multi-person path: enrich the multiPersonSelection with character display names
    // so the backend prompt labels subjects as "Henry Billion" not "additional_0"
    let finalMultiPersonSelection = effectiveMultiPersonSelection;
    if (finalMultiPersonSelection?.selectedCharacters) {
      finalMultiPersonSelection = {
        ...finalMultiPersonSelection,
        selectedCharacters: finalMultiPersonSelection.selectedCharacters.map(sc => {
          const charRecord = allCharacters.find(c => c.id === sc.id);
          return charRecord
            ? { ...sc, displayName: charRecord.name, firstName: (charRecord.name || '').split(/\s+/)[0] }
            : sc;
        }),
      };
    }

    setIsGenerating(true);
    setGenerateError(null);

    // Register foreground task — background systems yield during image generation
    if (user?.email) {
      foregroundTaskIdRef.current = registerUserForegroundTask(FOREGROUND_TASKS.IMAGE_GENERATION, {
        ownerEmail: user.email,
        priority: PRIORITY_LEVELS.CRITICAL,
        page: 'MediaGrid',
        durationMs: 60000, // 60s timeout for image generation
      });
    }

    try {
      // Create placeholder message
      // Non-character images are sent by whoever the sender tab indicates (character or user)
      const msgSenderType = (isNonCharacterMode && generationTab === 'user') ? 'user'
        : isNonCharacterMode ? 'character'
        : effectiveSubjectType === 'user' ? 'user' : 'character';
      const newMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: msgSenderType,
        character_id: isNonCharacterMode ? character.id : (resolvedCharacterId || undefined),
        character_name: isNonCharacterMode ? character.name : (resolvedCharacterName || undefined),
        content: "",
        emotional_state: character.emotional_state || "calm",
        timestamp: new Date().toISOString(),
        generation_context: {
          prompt: promptText, // always store the ORIGINAL user prompt — not the enriched version
          character_id: resolvedCharacterId,
          character_reference_images: resolvedCharRefImages,
          location_id: selectedLocation?.id || null,
          location_name: selectedLocation?.name || null,
          zone_name: selectedZone || null,
          subject_type: effectiveSubjectType,
        },
      });
      if (!newMsg?.id) throw new Error('Failed to create message');

      const genRes = await base44.functions.invoke('mediaGridGenerate', {
        messageId: newMsg.id,
        prompt: enrichedPrompt, // enriched with Name Reference Key — backend sees who "Henry" is
        subjectType: isNonCharacterMode ? 'non_character' : effectiveSubjectType,
        // Character identity — null for non-character or user-only mode
        characterId: isNonCharacterMode ? null : resolvedCharacterId,
        characterName: isNonCharacterMode ? null : resolvedCharacterName,
        characterRefImages: isNonCharacterMode ? [] : resolvedCharRefImages,
        // User identity
        userRefImages,
        userName: userSettings?.fictional_world_name || userChar?.world_name || userChar?.name || 'the user',
        // Environment — exactly what the user selected
        locationId: selectedLocation?.id || null,
        locationName: selectedLocation?.name || null,
        zoneName: selectedZone || (selectedLocation ? selectedLocation.zones?.find(z => z.image_urls?.length > 0)?.zone_name : null) || null,
        zoneImageUrls,
        // HARD IDENTITY LOCK: Multi-person selection with validated references.
        // Null when user-only or non-character mode — prevents character contamination.
        multiPersonSelection: isNonCharacterMode ? null : finalMultiPersonSelection,
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

      // Memory note — stored on the SENDER's record, not the subject's.
      // If the user is the sender, no character memory record is created (user has no character_id).
      const envNote = selectedLocation ? ` at ${selectedLocation.name}${selectedZone ? ` → ${selectedZone}` : ''}` : '';
      const senderCharId = effectiveSubjectType === 'user' ? null : resolvedCharacterId;
      if (senderCharId) {
        base44.entities.Memory.create({
          character_id: senderCharId,
          title: `Sent a photo`,
          description: `Sent a photo${envNote}. Prompt: "${promptText.substring(0, 80)}".`,
          emotional_impact: 'positive',
          timestamp: new Date().toISOString(),
          source_context: `gallery_generated_${newMsg.id}`,
        }).catch(() => {});
      }

      setPrompt("");
      setReferenceImageUrl(null);
      setReferenceImageSource(null);
      setReferenceImageMode("prompt_plus_image");
      setReferenceImagePurpose("general");
      setShowGridPicker(false);
      setIsOpen(false);
      onExternalClose?.();
      if (onImageGenerated) onImageGenerated({ ...newMsg, image_url: genRes.data.imageUrl });
    } catch (err) {
      setGenerateError(err.message || "Failed to generate image");
    } finally {
      setIsGenerating(false);
      // Clear foreground task
      if (user?.email && foregroundTaskIdRef.current) {
        clearUserForegroundTask(user.email, foregroundTaskIdRef.current);
        foregroundTaskIdRef.current = null;
      }
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
              onClick={() => { setIsOpen(false); onExternalClose?.(); }}
            >
              <div
                className="bg-card rounded-2xl max-w-5xl w-full max-h-[99vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    Media {images.length > 0 ? `(${images.length})` : ""}
                    {isFetchingImages && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
                  </h3>
                  <button onClick={() => { setIsOpen(false); onExternalClose?.(); }} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                </div>

                {/* Generate image panel — above images */}
                {character && conversationId && (
                  <div className="flex-shrink-0 overflow-y-auto border-b border-border bg-primary/5 mx-6 mt-4 mb-2 p-4 space-y-3 rounded-xl" style={{ maxHeight: '50vh' }}>
                    {/* Tab switcher */}
                    {/* Sender toggle — chooses WHO SENDS the image, NOT who appears in it */}
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Sender</p>
                      <div className="flex items-center gap-2">
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
                    </div>

                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <p className="text-sm font-medium text-foreground">
                        {generationTab === "character"
                          ? `Generate a photo from ${character.name}`
                          : `Generate a photo from ${userSettings?.fictional_world_name || allCharacters.find(c => c.is_user)?.world_name || "you"}`}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {generationTab === "character"
                        ? `${character.name} will send it in the chat and remember it.`
                        : `${userSettings?.fictional_world_name || allCharacters.find(c => c.is_user)?.world_name || "You"} will send it in the chat and remember it.`}
                    </p>

                    {/* Subject selector — chooses WHO APPEARS IN the image (separate from sender) */}
                    <div className="space-y-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Who appears in the image <span className="text-muted-foreground/50 normal-case font-normal">(optional)</span></p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Character picker button */}
                        <button
                          onClick={() => { setShowCharacterPicker(v => !v); setShowLocationPicker(false); setShowZonePicker(false); }}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-colors ${selectedCharacterIds.length > 0 ? 'bg-primary/10 border-primary/40 text-primary' : 'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-primary/40'}`}
                        >
                          <Users className="w-3.5 h-3.5" />
                          {selectedCharacterIds.length > 0 ? `${selectedCharacterIds.length} subject${selectedCharacterIds.length !== 1 ? 's' : ''} selected` : 'Add people to image'}
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
                      {showCharacterPicker && charsLoadStatus === 'error' && character && (
                        // Current chat character fallback — always available even when full roster fails
                        <div className="rounded-xl border border-border bg-card p-2 mb-1">
                          <p className="text-[10px] text-muted-foreground px-1 mb-1">Current character (roster load failed):</p>
                          <button
                            onClick={() => toggleCharacter(character.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${selectedCharacterIds.includes(character.id) ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary'}`}
                          >
                            {selectedCharacterIds.includes(character.id) && <Check className="w-3.5 h-3.5 text-primary" />}
                            {character.avatar_url ? (
                              <img src={character.avatar_url} alt={character.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">{getInitial(character.name)}</div>
                            )}
                            <span className="font-medium">{character.name}</span>
                          </button>
                        </div>
                      )}
                      {showCharacterPicker && charsLoadStatus === 'error' && (
                        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1.5">
                          <p className="font-medium">Character list failed to load.</p>
                          <p className="text-destructive/70">Both cache and server returned no data. This is a load failure, not an empty account.</p>
                          <button onClick={handleDropdownRetry} className="mt-1 px-3 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive font-medium transition-colors">Retry</button>
                          {charsDiagnostics && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[10px] text-destructive/60 hover:text-destructive/80">Show diagnostics</summary>
                              <div className="mt-1.5 space-y-0.5 font-mono text-[9px] text-destructive/70 bg-destructive/5 rounded-lg p-2">
                                <p>owner_email: {charsDiagnostics.owner_email ?? '—'}</p>
                                <p>source: {charsDiagnostics.source ?? 'direct_account_query'}</p>
                                <p>character_count: {charsDiagnostics.character_count ?? 'failed'}</p>
                                {charsDiagnostics.error && <p>error: {charsDiagnostics.error}</p>}
                              </div>
                            </details>
                          )}
                        </div>
                      )}

                      {showCharacterPicker && charsLoadStatus === 'loading' && allCharacters.length === 0 && (
                        <div className="rounded-xl border border-border bg-card px-3 py-4 text-xs text-muted-foreground flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading characters...
                        </div>
                      )}
                      {showCharacterPicker && allCharacters.length > 0 && (
                        <div className="rounded-xl border border-border bg-card shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                          {/* Grouped by type, alphabetical within each group:
                              1. User  2. active_created_character  3. npc_fictitious
                              4. npc_family_member  5. npc_regular  6. everything else */}
                          {(() => {
                            const TYPE_ORDER = {
                              _user: 0,
                              active_created_character: 1,
                              npc_fictitious: 2,
                              npc_family_member: 3,
                              npc_regular: 4,
                            };
                            const typeKey = c => c.is_user ? '_user' : (c.character_type || 'zzz');
                            const typeRank = c => TYPE_ORDER[typeKey(c)] ?? 99;
                            const alpha = (a, b) => (a.name || '').localeCompare(b.name || '');
                            return [...allCharacters].sort((a, b) => {
                              const rankDiff = typeRank(a) - typeRank(b);
                              return rankDiff !== 0 ? rankDiff : alpha(a, b);
                            });
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
                      {showLocationPicker && locsLoadStatus === 'error' && (
                        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1.5">
                          <p className="font-medium">Location list failed to load.</p>
                          <p className="text-destructive/70">Both cache and server returned no data. This is a load failure, not an empty account.</p>
                          <button onClick={handleDropdownRetry} className="mt-1 px-3 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive font-medium transition-colors">Retry</button>
                        </div>
                      )}
                      {showLocationPicker && locsLoadStatus === 'loading' && locations.length === 0 && (
                        <div className="rounded-xl border border-border bg-card px-3 py-4 text-xs text-muted-foreground flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading locations...
                        </div>
                      )}
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
                        placeholder={referenceImageUrl && referenceImageMode === "image_only" ? "Image-only mode — no prompt needed" : "Describe a scene, object, document, location... or click ✨ to auto-generate"}
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
                      disabled={isGenerating}
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
                            {/* Show regenerate for character-sent OR any app-generated image (has generation_context).
                                User-sent Media Grid images also have generation_context and support regeneration. */}
                            {(() => {
                              const srcMsg = messages.find(m => m.id === img.id);
                              const hasGenCtx = !!srcMsg?.generation_context;
                              return (img.senderType === "character" || hasGenCtx) ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setRegenTarget(img); }}
                                  className="p-1.5 rounded-full bg-white/20 text-white hover:bg-white/40 transition-colors"
                                  title="Regenerate"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                              ) : null;
                            })()}
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
                  {(() => {
                    const srcMsg = messages.find(m => m.id === selectedImage.id);
                    const hasGenCtx = !!srcMsg?.generation_context;
                    return (selectedImage.senderType === "character" || hasGenCtx) ? (
                      <button
                        onClick={() => { setRegenTarget(selectedImage); setSelectedImage(null); }}
                        className="px-4 py-2 rounded-lg bg-secondary border border-border text-foreground hover:border-primary/40 transition-colors flex items-center gap-2 text-sm"
                      >
                        <RefreshCw className="w-4 h-4" /> Regenerate
                      </button>
                    ) : null;
                  })()}
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
        generationContext={regenTarget ? (messages.find(m => m.id === regenTarget.id)?.generation_context || null) : null}
      />
    </>
  );
}