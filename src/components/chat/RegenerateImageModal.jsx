import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertTriangle, UserX, ThumbsDown, Loader2, PenLine, MapPin, Users, Check, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fetchUnifiedRoster, getInitial } from "@/lib/unifiedRosterUtils";
import { readCache, writeCache, isCacheStale, validateCharacterRoster } from "@/lib/mediaGridCache";
import { registerForegroundTask, FOREGROUND_TASKS } from "@/lib/foregroundPriority";

const REASONS = [
  {
    id: "flawed",
    icon: AlertTriangle,
    label: "Image is flawed",
    description: "Major failure — body morphing, wrong room layout, furniture glitches, texture errors, or both environment and character corrupted. Full maximum-fidelity re-render.",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30 hover:border-amber-500/60",
  },
  {
    id: "no_avatar",
    icon: UserX,
    label: "Doesn't look like them",
    description: "Same scene, stronger character likeness",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/30 hover:border-blue-500/60",
  },
  {
    id: "wrong_location",
    icon: MapPin,
    label: "Location is incorrect",
    description: "Pick the correct location and zone to use as the background",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/60",
  },
  {
    id: "dont_like",
    icon: ThumbsDown,
    label: "Don't like it",
    description: "Edit the original scene prompt and regenerate",
    color: "text-muted-foreground",
    bg: "bg-secondary border-border hover:border-primary/40",
  },
  {
    id: "custom_prompt",
    icon: PenLine,
    label: "Use my own prompt",
    description: "Write a fully custom prompt",
    color: "text-primary",
    bg: "bg-primary/10 border-primary/30 hover:border-primary/60",
  },
];

export default function RegenerateImageModal({ isOpen, onClose, onSelect, isRegenerating, error, originalPrompt, generationContext }) {
  const [editPrompt, setEditPrompt] = useState("");
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [promptMode, setPromptMode] = useState(null); // 'dont_like' | 'custom_prompt'
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);
  const [loadingLocations, setLoadingLocations] = useState(false);

  // Subject picker for "Doesn't look like them"
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);
  const [allCharacters, setAllCharacters] = useState([]);
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [rosterLoadStatus, setRosterLoadStatus] = useState('idle'); // 'idle'|'loading'|'cache'|'fresh'|'user_only'|'error'
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([]);
  const [userEmail, setUserEmail] = useState(null);
  // Ref so openSubjectPicker always has the email even if state hasn't propagated yet
  const userEmailRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(u => {
      if (u?.email) {
        userEmailRef.current = u.email;
        setUserEmail(u.email);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setShowPromptInput(false);
      setEditPrompt("");
      setPromptMode(null);
      setShowLocationPicker(false);
      setSelectedLocation(null);
      setSelectedZone(null);
      setShowSubjectPicker(false);
      setSelectedSubjectIds([]);
    }
  }, [isOpen]);

  // Re-sync editPrompt if originalPrompt changes while modal is open in dont_like mode
  useEffect(() => {
    if (isOpen && promptMode === "dont_like") {
      setEditPrompt(originalPrompt || "");
    }
  }, [originalPrompt, promptMode, isOpen]);

  // Pre-select subjects from generation_context.
  // Always use canonical_person_id for pre-selection — never synthetic IDs.
  const applyPreSelection = (roster) => {
    const ctx = generationContext || {};
    const preSelected = [];
    if (ctx.subjects?.length > 0) {
      ctx.subjects.forEach(s => {
        if (s.subject_id) {
          // Resolve subject_id to canonical via roster
          const rosterEntry = roster.find(r => r.id === s.subject_id || r.source_record_ids?.includes(s.subject_id));
          const canonicalId = rosterEntry?.canonical_person_id || s.subject_id;
          if (canonicalId && !rosterEntry?.image_generation_blocked) preSelected.push(canonicalId);
        }
      });
    } else if (ctx.character_id) {
      const rosterEntry = roster.find(r => r.id === ctx.character_id || r.source_record_ids?.includes(ctx.character_id));
      const canonicalId = rosterEntry?.canonical_person_id || ctx.character_id;
      if (canonicalId && !rosterEntry?.image_generation_blocked) preSelected.push(canonicalId);
    }
    if (ctx.subject_type === 'user' || ctx.isUserSubject) {
      preSelected.push('__user__');
    }
    setSelectedSubjectIds(preSelected.length > 0 ? preSelected : []);
  };

  // Pre-select subjects from generation_context when opening subject picker.
  // CRITICAL FIX: email is read from ref (always current) not state (may be null on first render).
  // Uses last-known-good cache from mediaGridCache — same rules as Media Grid Image Generator.
  const openSubjectPicker = () => {
    setShowSubjectPicker(true);

    // Use the ref so email is guaranteed available even if state hasn't updated yet
    const email = userEmailRef.current || userEmail;

    // ── STEP 1: Show cache immediately ──────────────────────────────────────
    const cached = email ? readCache(email, 'characters') : null;
    if (cached) {
      setAllCharacters(cached.records);
      setRosterLoadStatus('cache');
      applyPreSelection(cached.records);
      // If cache is fresh, no server fetch needed
      if (!isCacheStale(cached)) return;
    }

    // ── STEP 2: Fetch from server ────────────────────────────────────────────
    if (!email) {
      // Email not yet resolved — show error rather than silently showing only user
      setRosterLoadStatus('error');
      return;
    }

    setLoadingCharacters(cached ? false : true); // Only show spinner if no cache to show
    setRosterLoadStatus(cached ? 'cache' : 'loading');

    // Register foreground task — background systems yield while user is picking subjects
    const releaseForeground = registerForegroundTask(FOREGROUND_TASKS.MEDIA_GRID, 'high');

    fetchUnifiedRoster(base44, email)
      .then(roster => {
        const validation = validateCharacterRoster(roster);
        if (validation.valid) {
          setAllCharacters(roster);
          writeCache(email, 'characters', roster);
          setRosterLoadStatus('fresh');
          applyPreSelection(roster);
        } else if (validation.reason === 'user_only') {
          // User-only result — suspicious. Keep cache if available, warn.
          if (!cached) {
            setAllCharacters(roster || []);
          }
          setRosterLoadStatus('user_only');
          console.warn('[RegenerateModal] Roster returned user-only — may be incomplete. Cache preserved.');
        } else {
          // Empty — keep cache if available, show error if not
          setRosterLoadStatus(cached ? 'cache' : 'error');
          console.warn('[RegenerateModal] Roster returned empty — preserving cache if available.');
        }
      })
      .catch(err => {
        console.error('[RegenerateModal] fetchUnifiedRoster failed:', err?.message);
        setRosterLoadStatus(cached ? 'cache' : 'error');
      })
      .finally(() => {
        setLoadingCharacters(false);
        releaseForeground();
      });
  };

  const handleRosterRetry = () => {
    setAllCharacters([]);
    setRosterLoadStatus('idle');
    openSubjectPicker();
  };

  const toggleSubject = (id) => {
    setSelectedSubjectIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleConfirmSubjectPicker = () => {
    const hasUser = selectedSubjectIds.includes('__user__');
    // Only pass canonical_person_ids that are NOT blocked — these are real Character.ids
    const charIds = selectedSubjectIds.filter(id => {
      if (id === '__user__') return false;
      const entry = allCharacters.find(c => c.canonical_person_id === id || c.id === id);
      return !entry?.image_generation_blocked;
    });
    onSelect('no_avatar', null, null, null, null, null, { intendedSubjectIds: charIds, includeUser: hasUser });
    setShowSubjectPicker(false);
  };

  const handleSelect = (id) => {
   if (id === "no_avatar") {
     openSubjectPicker();
     return;
   }
   if (id === "wrong_location") {
     setShowLocationPicker(true);
     setLoadingLocations(true);
     const tryFetch = () => base44.functions.invoke('fetchAllLocationsForUser', {}).then(res => {
       const locs = res?.data?.locations || res?.locations || [];
       console.log(`[RegenerateModal] Fetched ${locs.length} locations`);
       setLocations(locs);
     });
     tryFetch().catch(err => {
       console.error(`[RegenerateModal] fetchAllLocationsForUser error:`, err?.message);
       const is429 = err?.message?.includes('429') || err?.message?.includes('Rate limit') || err?.message?.includes('rate limit');
       if (is429) {
         // Retry once after 3s — same transient rate-limit pattern as chat load
         return new Promise(r => setTimeout(r, 3000)).then(tryFetch).catch(() => setLocations([]));
       }
       setLocations([]);
     }).finally(() => setLoadingLocations(false));
     return;
   }
    if (id === "dont_like") {
      setPromptMode("dont_like");
      setEditPrompt(originalPrompt || "");
      setShowPromptInput(true);
      return;
    }
    if (id === "custom_prompt") {
      setPromptMode("custom_prompt");
      setEditPrompt("");
      setShowPromptInput(true);
      return;
    }
    onSelect(id, null);
  };

  const handleSubmit = () => {
    if (!editPrompt.trim()) return;
    onSelect(promptMode, editPrompt.trim());
    setEditPrompt("");
    setShowPromptInput(false);
    setPromptMode(null);
  };

  const handleClose = () => {
    setShowPromptInput(false);
    setEditPrompt("");
    setPromptMode(null);
    setShowLocationPicker(false);
    setSelectedLocation(null);
    setSelectedZone(null);
    onClose();
  };

  const handleLocationConfirm = () => {
    if (!selectedLocation) return;
    const zoneName = selectedZone?.zone_name || null;
    // Pass the zone preview images directly — no re-lookup needed on the backend
    const zoneImages = selectedZone?.image_urls?.length > 0
      ? selectedZone.image_urls
      : selectedLocation.zones?.find(z => z.image_urls?.length > 0)?.image_urls
        || selectedLocation.image_urls
        || [];
    console.log(`[RegenerateModal] LocationConfirm: location="${selectedLocation.name}" (${selectedLocation.id}) | zone="${zoneName}" | directImages=${zoneImages.length}`);
    onSelect('wrong_location', null, selectedLocation.id, zoneName, zoneImages, selectedLocation.name);
  };

  const promptTitle = promptMode === "dont_like"
    ? "Edit the original prompt"
    : "Describe what you want";

  const promptPlaceholder = promptMode === "dont_like"
    ? "Edit the scene description above..."
    : "e.g. 'at the beach, golden hour, smiling'";

  return createPortal(
  <AnimatePresence>
    {isOpen && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-[60] flex items-end justify-center p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">
              {showSubjectPicker ? "Who was supposed to be in it?" : showPromptInput ? promptTitle : "Why regenerate?"}
            </h3>
            <button onClick={handleClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {showSubjectPicker ? (
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">Select who the image was supposed to show. The system will regenerate with that person's appearance locked.</p>
              {loadingCharacters ? (
                <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : rosterLoadStatus === 'error' ? (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1.5">
                  <p className="font-medium">Character list failed to load.</p>
                  <p className="text-destructive/70">Could not fetch your characters. This is a load failure — not an empty account.</p>
                  <button onClick={handleRosterRetry} className="mt-1 flex items-center gap-1.5 px-3 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive font-medium transition-colors">
                    <RefreshCw className="w-3 h-3" /> Retry
                  </button>
                </div>
              ) : (
                <>
                  {rosterLoadStatus === 'user_only' && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-400 flex items-center justify-between gap-2 mb-1">
                      <span>Character list may be incomplete — only your profile loaded.</span>
                      <button onClick={handleRosterRetry} className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-medium flex-shrink-0">
                        <RefreshCw className="w-3 h-3" /> Retry
                      </button>
                    </div>
                  )}
                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {/* User entry */}
                    <button
                      onClick={() => toggleSubject('__user__')}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all text-sm text-left ${selectedSubjectIds.includes('__user__') ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/40 text-foreground hover:border-primary/40'}`}
                    >
                      {selectedSubjectIds.includes('__user__') && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                      <Users className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                      <span className="font-medium">Me / My persona</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">(You)</span>
                    </button>
                    {/* Characters — sorted alphabetically. Unresolved entries are display-only, blocked from generation. */}
                    {[...allCharacters.filter(c => !c.is_user)]
                      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                      .map(char => {
                        // Use canonical_person_id as the picker key — never synthetic IDs
                        const pickerId = char.canonical_person_id || char.id;
                        const isBlocked = char.image_generation_blocked === true;
                        const isSelected = selectedSubjectIds.includes(pickerId);
                        return (
                          <button
                            key={pickerId}
                            onClick={() => !isBlocked && toggleSubject(pickerId)}
                            disabled={isBlocked}
                            title={isBlocked ? `${char.name} is unresolved — no Character record exists. Cannot use in image generation.` : undefined}
                            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all text-sm text-left ${
                              isBlocked
                                ? 'border-border/30 bg-secondary/20 text-muted-foreground/50 cursor-not-allowed opacity-50'
                                : isSelected
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border bg-secondary/40 text-foreground hover:border-primary/40'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                            {char.avatar_url ? (
                              <img src={char.avatar_url} alt={char.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" onError={e => { e.target.style.display = 'none'; }} />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">{getInitial(char.name)}</div>
                            )}
                            <span className="font-medium truncate">{char.name}</span>
                            {isBlocked && <span className="text-[9px] text-muted-foreground/50 ml-auto flex-shrink-0">unresolved</span>}
                          </button>
                        );
                      })}
                    {allCharacters.filter(c => !c.is_user).length === 0 && rosterLoadStatus !== 'loading' && rosterLoadStatus !== 'error' && (
                      <p className="text-xs text-muted-foreground text-center py-3 italic">No characters on this account</p>
                    )}
                  </div>
                </>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowSubjectPicker(false); setSelectedSubjectIds([]); }}
                  className="flex-1 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirmSubjectPicker}
                  disabled={selectedSubjectIds.length === 0 || isRegenerating}
                  className="flex-1 py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Regenerate
                </button>
              </div>
            </div>
          ) : showLocationPicker ? (
            <div className="p-4 space-y-3">
              {!selectedLocation ? (
                <>
                  <p className="text-xs text-muted-foreground">Select the correct location:</p>
                  {loadingLocations ? (
                    <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto space-y-1.5">
                      {locations.map(loc => (
                        <button
                          key={loc.id}
                          onClick={() => { setSelectedLocation(loc); setSelectedZone(null); }}
                          className="w-full text-left px-3 py-2.5 rounded-xl border border-border bg-secondary/40 hover:border-primary/50 hover:bg-primary/5 transition-all"
                        >
                          <p className="text-sm font-medium text-foreground">{loc.name}</p>
                          {loc.zones?.length > 0 && <p className="text-[10px] text-muted-foreground">{loc.zones.length} zone{loc.zones.length > 1 ? 's' : ''}</p>}
                        </button>
                      ))}
                      {locations.length === 0 && <p className="text-xs text-muted-foreground italic text-center py-3">No locations found</p>}
                    </div>
                  )}
                  <button onClick={() => setShowLocationPicker(false)} className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedLocation(null)} className="text-xs text-muted-foreground hover:text-foreground">←</button>
                    <p className="text-sm font-semibold text-foreground">{selectedLocation.name}</p>
                  </div>
                  {selectedLocation.zones?.filter(z => z.image_urls?.length > 0).length > 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground">Select a zone (optional):</p>
                      <div className="space-y-1.5 max-h-44 overflow-y-auto">
                        <button
                          onClick={() => setSelectedZone(null)}
                          className={`w-full text-left px-3 py-2 rounded-xl border transition-all text-sm ${
                            !selectedZone ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border bg-secondary/40 text-foreground hover:border-primary/40'
                          }`}
                        >
                          Any zone (auto-detect)
                        </button>
                        {selectedLocation.zones.filter(z => z.image_urls?.length > 0).map(zone => (
                          <button
                            key={zone.zone_name}
                            onClick={() => setSelectedZone(zone)}
                            className={`w-full text-left px-3 py-2 rounded-xl border transition-all text-sm ${
                              selectedZone?.zone_name === zone.zone_name ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border bg-secondary/40 text-foreground hover:border-primary/40'
                            }`}
                          >
                            {zone.zone_name}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No zones — will use location images directly.</p>
                  )}
                  <button
                    onClick={handleLocationConfirm}
                    disabled={isRegenerating}
                    className="w-full py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                    Regenerate with this location
                  </button>
                </>
              )}
            </div>
          ) : showPromptInput ? (
              <div className="p-4 space-y-3">
                {promptMode === "dont_like" && originalPrompt && (
                  <p className="text-[10px] text-muted-foreground/60">Original prompt pre-loaded — edit it below</p>
                )}
                <textarea
                  value={editPrompt}
                  onChange={e => setEditPrompt(e.target.value)}
                  placeholder={promptPlaceholder}
                  rows={4}
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowPromptInput(false); setEditPrompt(""); setPromptMode(null); }}
                    className="flex-1 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!editPrompt.trim() || isRegenerating}
                    className="flex-1 py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Generate
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 space-y-2">
                  {REASONS.map((r) => {
                    const Icon = r.icon;
                    return (
                      <button
                        key={r.id}
                        onClick={() => handleSelect(r.id)}
                        disabled={isRegenerating}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left disabled:opacity-50 ${r.bg}`}
                      >
                        <Icon className={`w-5 h-5 flex-shrink-0 ${r.color}`} />
                        <div>
                          <p className="text-sm font-medium text-foreground">{r.label}</p>
                          <p className="text-xs text-muted-foreground">{r.description}</p>
                        </div>
                        {isRegenerating && <Loader2 className="w-4 h-4 ml-auto animate-spin text-muted-foreground" />}
                      </button>
                    );
                  })}
                </div>
                {error && (
                  <p className="text-xs text-destructive text-center px-4 pb-2">{error}</p>
                )}
                <p className="text-[10px] text-muted-foreground/50 text-center pb-4">Your feedback helps generate a better image</p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}