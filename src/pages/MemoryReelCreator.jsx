/**
 * MemoryReelCreator
 *
 * SOURCE-LOCK ARCHITECTURE:
 * - The reel is built entirely from user-selected Media Grid images.
 * - Image-to-video generation uses the source image as existing_image_urls (source frame).
 * - A ReelGenerationJob entity persists the job state so navigation away does not lose work.
 * - The client-side ReelPlayer renders the final montage from the locked clip_results.
 * - No freeform AI video generation that could invent random people or scenes.
 *
 * ACTIVATION FLOW:
 * Moments → "Create Memory Reel" → inactive start screen → "Start Building Reel"
 * → only then queries 30 days of media → user selects → "Create Vid" → background job
 * → user can navigate away → returns and resumes job → ReelPlayer on completion
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Film, Play, Download, Send, Trash2, Sparkles, Camera,
  CheckSquare, Square, Zap, AlertTriangle, Loader2, X,
  ChevronDown, ChevronUp, Image, RefreshCw, StopCircle, Edit3
} from "lucide-react";
import ReelPlayer from "@/components/moments/ReelPlayer";

// ── STATUS LABELS ─────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  queued:     { label: "Queued",                    pct: 5  },
  preparing:  { label: "Preparing images",          pct: 15 },
  animating:  { label: "Animating selected clips",  pct: 40 },
  assembling: { label: "Assembling reel",           pct: 80 },
  validating: { label: "Validating selected images", pct: 92 },
  complete:   { label: "Complete",                  pct: 100 },
  failed:     { label: "Failed",                    pct: 100 },
  cancelled:  { label: "Cancelled",                 pct: 0  },
};

const POLL_INTERVAL = 6000; // ms — poll job status every 6s while processing

// ── IMAGE CARD ────────────────────────────────────────────────────────────────
function ImageCard({ item, onToggle, onAnimateToggle, onCaptionChange }) {
  const [showCaption, setShowCaption] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-2xl border overflow-hidden transition-all ${
        item.included ? "border-primary/60 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="relative aspect-square">
        <img
          src={item.image_url}
          alt={item.character_name || "Memory"}
          className="w-full h-full object-cover"
          draggable={false}
        />
        <button
          onClick={() => onToggle(item.id)}
          className="absolute top-2 left-2 p-1 rounded-lg bg-black/50 hover:bg-black/70 transition-colors"
        >
          {item.included
            ? <CheckSquare className="w-4 h-4 text-primary" />
            : <Square className="w-4 h-4 text-white/80" />
          }
        </button>
        {item.included && (
          <button
            onClick={() => onAnimateToggle(item.id)}
            title={item.animate ? "Animate: ON — will use image-to-video" : "Static: image will be a photo slide"}
            className={`absolute top-2 right-2 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1 ${
              item.animate
                ? "bg-primary text-primary-foreground"
                : "bg-black/50 text-white/70 hover:bg-black/70"
            }`}
          >
            <Zap className="w-2.5 h-2.5" />
            {item.animate ? "Animate" : "Static"}
          </button>
        )}
      </div>

      <div className="p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5">
          {item.avatar_url && (
            <img src={item.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
          )}
          <p className="text-xs font-medium text-foreground truncate">{item.character_name || "Unknown"}</p>
          <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">{item.date_label}</span>
        </div>

        {item.prompt_preview ? (
          <p className="text-[10px] text-muted-foreground/70 italic line-clamp-2">"{item.prompt_preview}"</p>
        ) : (
          <p className="text-[10px] text-amber-400/70 flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" /> No prompt — static slide only
          </p>
        )}

        {item.included && (
          <div>
            <button
              onClick={() => setShowCaption(v => !v)}
              className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-1"
            >
              {showCaption ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Caption
            </button>
            {showCaption && (
              <input
                type="text"
                value={item.caption || ""}
                onChange={e => onCaptionChange(item.id, e.target.value)}
                placeholder="Add a caption..."
                maxLength={80}
                className="mt-1 w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground"
              />
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── CHARACTER PICKER ──────────────────────────────────────────────────────────
function CharacterPicker({ characters, onSelect, onClose }) {
  const [picked, setPicked] = useState(null);
  const [message, setMessage] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Send className="w-4 h-4 text-primary" /> Send to Character
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto divide-y divide-border">
          {characters.map(c => (
            <button
              key={c.id}
              onClick={() => setPicked(c)}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary transition-colors text-left ${picked?.id === c.id ? "bg-primary/10" : ""}`}
            >
              {c.avatar_url
                ? <img src={c.avatar_url} alt={c.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                : <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary">{c.name?.[0]}</span>
                  </div>
              }
              <p className="text-sm font-medium text-foreground">{c.name}</p>
              {picked?.id === c.id && <CheckSquare className="w-4 h-4 text-primary ml-auto" />}
            </button>
          ))}
        </div>
        <div className="p-4 space-y-3 border-t border-border">
          <input
            type="text"
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Add a message (optional)..."
            maxLength={200}
            className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground"
          />
          <button
            onClick={() => picked && onSelect(picked, message)}
            disabled={!picked}
            className="w-full h-10 rounded-2xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" /> Send Reel
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function MemoryReelCreator() {
  const [activated, setActivated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mediaItems, setMediaItems] = useState([]);
  const [charFilter, setCharFilter] = useState("all");
  const [memories, setMemories] = useState([]);
  const [loadError, setLoadError] = useState(null);

  // Persistent job tracking
  const [activeJob, setActiveJob] = useState(null); // ReelGenerationJob record
  const [jobSubmitting, setJobSubmitting] = useState(false);
  const [jobError, setJobError] = useState(null);
  const pollTimerRef = useRef(null);

  // Post-completion UI
  const [showCharPicker, setShowCharPicker] = useState(false);
  const [sendStatus, setSendStatus] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Partial preview
  const [showPartialPreview, setShowPartialPreview] = useState(false);

  // Job controls
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ status: "active", owner_email: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  // On mount: check for an existing in-progress or completed job
  useEffect(() => {
    if (!currentUser?.email) return;
    base44.entities.ReelGenerationJob
      .filter({ owner_email: currentUser.email }, "-created_date", 5)
      .then(jobs => {
        // Find the most recent non-deleted job that is in-progress or complete
        const live = jobs.find(j =>
          j.status !== 'failed' ||
          (j.status === 'complete')
        );
        const inProgress = jobs.find(j => ['queued','preparing','animating','assembling','validating'].includes(j.status));
        const complete = jobs.find(j => j.status === 'complete');
        if (inProgress) {
          setActiveJob(inProgress);
          setActivated(true);
          startPolling(inProgress.id);
        } else if (complete) {
          setActiveJob(complete);
          setActivated(true);
        }
      })
      .catch(() => {});
  }, [currentUser?.email]);

  // ── POLLING ─────────────────────────────────────────────────────────────────
  const startPolling = useCallback((jobId) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      try {
        const jobs = await base44.entities.ReelGenerationJob.filter({ owner_email: currentUser?.email }, "-created_date", 5);
        const job = jobs.find(j => j.id === jobId);
        if (job) {
          setActiveJob(job);
          if (['complete', 'failed', 'cancelled'].includes(job.status)) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      } catch (_) {}
    }, POLL_INTERVAL);
  }, [currentUser?.email]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // ── ACTIVATION ───────────────────────────────────────────────────────────────
  const handleActivate = useCallback(async () => {
    if (!currentUser?.email) return;
    setActivated(true);
    setLoading(true);
    setLoadError(null);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffISO = cutoff.toISOString();

    try {
      const [recentMessages, recentMemories] = await Promise.all([
        base44.entities.Message.filter({ sender_type: "character" }, "-created_date", 400).catch(() => []),
        base44.entities.CharacterMemory.filter({}, "-created_date", 150).catch(() => []),
      ]);

      const charById = Object.fromEntries(characters.map(c => [c.id, c]));
      const ownedCharIds = new Set(characters.map(c => c.id));

      // Only images from the user's own characters, within 30 days
      const rawMedia = recentMessages.filter(m =>
        m.image_url &&
        m.created_date >= cutoffISO &&
        (!m.character_id || ownedCharIds.has(m.character_id))
      ).slice(0, 60);

      const seenUrls = new Set();
      const dedupedMedia = rawMedia.filter(m => {
        if (seenUrls.has(m.image_url)) return false;
        seenUrls.add(m.image_url);
        return true;
      });

      const items = dedupedMedia.slice(0, 30).map(m => {
        const char = charById[m.character_id] || null;
        const genCtx = m.generation_context || {};
        const prompt = genCtx.prompt || null;
        return {
          id: m.id,
          message_id: m.id,
          image_url: m.image_url,
          character_id: m.character_id || null,
          character_name: char?.name || m.character_name || "Unknown",
          avatar_url: char?.avatar_url || null,
          prompt_preview: prompt ? prompt.slice(0, 120) : null,
          full_prompt: prompt || null,
          date_label: new Date(m.created_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          created_date: m.created_date,
          included: true,
          animate: !!(prompt),
          caption: "",
        };
      });

      const filteredMemories = recentMemories
        .filter(mem => mem.created_date >= cutoffISO)
        .slice(0, 20);

      setMediaItems(items);
      setMemories(filteredMemories);
    } catch (err) {
      setLoadError(err?.message || "Failed to load media. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.email, characters]);

  const toggleInclude = (id) => setMediaItems(prev => prev.map(m => m.id === id ? { ...m, included: !m.included } : m));
  const toggleAnimate = (id) => setMediaItems(prev => prev.map(m => m.id === id ? { ...m, animate: !m.animate } : m));
  const setCaption = (id, caption) => setMediaItems(prev => prev.map(m => m.id === id ? { ...m, caption } : m));

  const selectedItems = mediaItems.filter(m => m.included);
  const filteredItems = charFilter === "all" ? mediaItems : mediaItems.filter(m => m.character_id === charFilter);
  const mediaCharIds = [...new Set(mediaItems.map(m => m.character_id).filter(Boolean))];
  const filterChars = characters.filter(c => mediaCharIds.includes(c.id));

  // ── CREATE VID — creates persistent job then kicks off backend processing ──
  const handleGenerate = async () => {
    if (selectedItems.length === 0 || jobSubmitting) return;
    setJobSubmitting(true);
    setJobError(null);

    try {
      const charNames = [...new Set(selectedItems.map(i => i.character_name))].join(", ");
      const memoryHighlights = memories.slice(0, 5).map(m => m.memory_summary || m.memory_text?.slice(0, 80)).filter(Boolean);

      // Build clip_results pre-populated with animate flags and captions
      // (the backend will fill in clip_url after generation)
      const preClipResults = selectedItems.map(item => ({
        image_id: item.id,
        image_url: item.image_url,
        clip_url: null,
        clip_type: 'static',
        animate: item.animate && !!(item.full_prompt),
        caption: item.caption || '',
        status: 'pending',
      }));

      // Create the persistent job record
      const job = await base44.entities.ReelGenerationJob.create({
        owner_email: currentUser.email,
        status: 'queued',
        progress_percent: 0,
        selected_image_ids: selectedItems.map(i => i.id),
        selected_image_urls: selectedItems.map(i => i.image_url),
        selected_character_ids: [...new Set(selectedItems.map(i => i.character_id).filter(Boolean))],
        clip_results: preClipResults,
        char_names: charNames,
        memory_highlights: memoryHighlights,
        thumbnail_url: selectedItems[0]?.image_url || null,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        estimated_time_remaining: preClipResults.some(c => c.animate) ? '3–6 minutes' : '1–2 minutes',
      });

      setActiveJob(job);
      startPolling(job.id);

      // Kick off backend processing (fire-and-forget style — job persists independently)
      base44.functions.invoke('processReelGenerationJob', { job_id: job.id }).catch(err => {
        console.error('[MemoryReelCreator] Backend job invoke failed:', err?.message);
        // Job status will remain 'queued' — user can retry
      });

    } catch (err) {
      setJobError(err?.message || "Failed to start reel generation.");
    } finally {
      setJobSubmitting(false);
    }
  };

  // ── RETRY failed job ────────────────────────────────────────────────────────
  const handleRetry = async () => {
    if (!activeJob) return;
    // Reset the job to queued
    await base44.entities.ReelGenerationJob.update(activeJob.id, {
      status: 'queued',
      progress_percent: 0,
      error_message: null,
      validation_notes: [],
      updated_at: new Date().toISOString(),
    }).catch(() => {});
    const refreshed = await base44.entities.ReelGenerationJob.filter({ owner_email: currentUser.email }, "-created_date", 5);
    const job = refreshed.find(j => j.id === activeJob.id);
    if (job) setActiveJob(job);
    startPolling(job?.id || activeJob.id);
    base44.functions.invoke('processReelGenerationJob', { job_id: activeJob.id }).catch(() => {});
  };

  // ── CANCEL GENERATION ─────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!activeJob || cancelling) return;
    setCancelling(true);
    try {
      await base44.entities.ReelGenerationJob.update(activeJob.id, {
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      });
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      // Refresh job state
      const refreshed = await base44.entities.ReelGenerationJob.filter({ owner_email: currentUser.email }, "-created_date", 5);
      const job = refreshed.find(j => j.id === activeJob.id);
      if (job) setActiveJob(job);
    } finally {
      setCancelling(false);
    }
  };

  // ── RESTART GENERATION ────────────────────────────────────────────────────
  // Cancels the active job, creates a new job reusing selected images + settings
  const handleRestart = async () => {
    if (!activeJob || restarting) return;
    setRestarting(true);
    setShowRestartConfirm(false);
    try {
      // Cancel active job first
      await base44.entities.ReelGenerationJob.update(activeJob.id, {
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      }).catch(() => {});
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      // Reuse original selections from the cancelled job
      const prevClips = activeJob.clip_results || [];
      const preClipResults = prevClips.map(c => ({
        image_id: c.image_id,
        image_url: c.image_url,
        clip_url: null,
        clip_type: 'static',
        animate: c.animate,
        caption: c.caption || '',
        status: 'pending',
      }));

      const newJob = await base44.entities.ReelGenerationJob.create({
        owner_email: currentUser.email,
        status: 'queued',
        progress_percent: 0,
        selected_image_ids: activeJob.selected_image_ids || [],
        selected_image_urls: activeJob.selected_image_urls || [],
        selected_character_ids: activeJob.selected_character_ids || [],
        clip_results: preClipResults,
        char_names: activeJob.char_names || '',
        memory_highlights: activeJob.memory_highlights || [],
        thumbnail_url: activeJob.thumbnail_url || null,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        estimated_time_remaining: preClipResults.some(c => c.animate) ? '3–6 minutes' : '1–2 minutes',
      });

      setActiveJob(newJob);
      startPolling(newJob.id);
      base44.functions.invoke('processReelGenerationJob', { job_id: newJob.id }).catch(() => {});
    } finally {
      setRestarting(false);
    }
  };

  // ── EDIT SELECTION (after cancel) ─────────────────────────────────────────
  // Restores the media selection UI from the cancelled job's data
  const handleEditSelection = () => {
    if (!activeJob) return;
    // Restore mediaItems from the cancelled job's clip_results
    const prevClips = activeJob.clip_results || [];
    if (prevClips.length > 0) {
      setMediaItems(prevClips.map(c => ({
        id: c.image_id,
        message_id: c.image_id,
        image_url: c.image_url,
        character_id: null,
        character_name: 'Unknown',
        avatar_url: null,
        prompt_preview: null,
        full_prompt: null,
        date_label: '',
        created_date: '',
        included: true,
        animate: c.animate || false,
        caption: c.caption || '',
      })));
    }
    setActiveJob(null);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  };

  // ── SEND TO CHARACTER ─────────────────────────────────────────────────────
  const handleSendToCharacter = async (char, caption) => {
    if (!activeJob?.clip_results?.length || !currentUser?.email) return;
    setShowCharPicker(false);
    setSendStatus('sending');

    try {
      const convos = await base44.entities.Conversation.filter(
        { character_ids: [char.id], owner_email: currentUser.email },
        "-updated_date", 5
      ).catch(() => []);

      let convoId = convos[0]?.id;
      if (!convoId) {
        const newConvo = await base44.entities.Conversation.create({
          title: `Chat with ${char.name}`,
          type: "direct",
          character_ids: [char.id],
          owner_email: currentUser.email,
        });
        convoId = newConvo.id;
      }

      await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "user",
        content: caption || `I made a memory reel featuring ${activeJob.char_names}! 🎬✨`,
        image_url: activeJob.thumbnail_url || null,
        timestamp: new Date().toISOString(),
        generation_context: {
          subject_type: "memory_reel",
          thumbnail_url: activeJob.thumbnail_url,
          sender_user_id: currentUser.id,
          recipient_character_id: char.id,
          owner_email: currentUser.email,
          media_type: "memory_reel",
          related_character_ids: activeJob.selected_character_ids || [],
          clip_results: activeJob.clip_results,
          source: "moments_memory_reel_creator",
          created_at: new Date().toISOString(),
        },
      });

      const memText = `${currentUser.full_name || "The user"} sent me a memory reel they created on ${new Date().toLocaleDateString()}. It featured ${activeJob.char_names}. ${caption ? `They wrote: "${caption}"` : ""}`;
      await base44.entities.CharacterMemory.create({
        character_id: char.id,
        memory_type: "event",
        memory_text: memText,
        memory_summary: `Received a memory reel from the user featuring ${activeJob.char_names}.`,
        importance_score: 7,
        confidence_score: 1.0,
        permanence: "long_term",
        validation_status: "confirmed",
      }).catch(() => {});

      setSendStatus('sent');
    } catch (err) {
      setSendStatus('error');
    }
  };

  // ── DELETE ─────────────────────────────────────────────────────────────────
  const handleDeleteReel = async () => {
    if (!activeJob) return;
    setDeleting(true);
    try {
      await base44.entities.ReelGenerationJob.delete(activeJob.id).catch(() => {});
      setActiveJob(null);
      setShowDeleteConfirm(false);
      setSendStatus(null);
    } finally {
      setDeleting(false);
    }
  };

  // ── INACTIVE START SCREEN ─────────────────────────────────────────────────
  if (!activated) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-50">
          <Link to="/moments" className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-sm font-bold text-foreground">Memory Reel Creator</h1>
            <p className="text-xs text-muted-foreground">Instagram Reel / TikTok style memory video</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto">
              <Film className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Memory Reel Creator</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
                Turn your recent character moments into a TikTok / Instagram Reel-style memory montage using your actual Media Grid photos.
              </p>
            </div>
          </div>

          <div className="w-full max-w-xs space-y-3 text-xs text-muted-foreground">
            {[
              { icon: Camera, text: "Uses your actual Media Grid images from the past month" },
              { icon: Zap,    text: "Optionally animates each photo using image-to-video (source-locked)" },
              { icon: Film,   text: "Renders a vertical 9:16 Reel/TikTok style gallery montage" },
              { icon: Send,   text: "Send directly to a character's chat" },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary/50">
                <Icon className="w-4 h-4 text-primary flex-shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>

          <div className="w-full max-w-xs space-y-2">
            <button
              onClick={handleActivate}
              disabled={!currentUser?.email || characters.length === 0}
              className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              Start Building Reel
            </button>
            {characters.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center">You need at least one active character.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-50">
          <Link to="/moments" className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-sm font-bold text-foreground">Memory Reel Creator</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Loading your recent memories…</p>
          <p className="text-xs text-muted-foreground/60">Scanning the past 30 days</p>
        </div>
      </div>
    );
  }

  // ── ACTIVE JOB: if a job is in-flight or complete, show its status ─────────
  if (activeJob) {
    const isProcessing = ['queued','preparing','animating','assembling','validating'].includes(activeJob.status);
    const isComplete = activeJob.status === 'complete';
    const isFailed = activeJob.status === 'failed';
    const isCancelled = activeJob.status === 'cancelled';
    const statusInfo = STATUS_LABELS[activeJob.status] || STATUS_LABELS.queued;
    const clips = (activeJob.clip_results || []).filter(c => c.image_url);

    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-50">
          <Link to="/moments" className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-foreground">Memory Reel Creator</h1>
            <p className="text-xs text-muted-foreground">
              {isProcessing ? `${statusInfo.label}…` : isComplete ? "Your reel is ready!" : isCancelled ? "Generation cancelled" : "Generation failed"}
            </p>
          </div>
          {isProcessing && (
            <span className="text-xs text-primary/80 font-medium">{activeJob.progress_percent || 0}%</span>
          )}
        </div>

        <div className="px-4 py-5 space-y-6">

          {/* Partial preview button — appears at 25%+ with at least one validated clip */}
          {isProcessing && (() => {
            // Only show clips that are static or have valid veo_diagnostics with source+avatar confirmed
            const validatedClips = (activeJob.clip_results || []).filter(c =>
              c.image_url && (
                c.clip_type === 'static' ||
                (c.clip_type === 'animated' && c.veo_diagnostics?.source_image_url && c.veo_diagnostics?.avatar_reference_url)
              )
            );
            const pct = activeJob.progress_percent || 0;
            const canPreview = pct >= 25 && validatedClips.length > 0;
            if (!canPreview) return null;
            return (
              <div className="rounded-xl border border-primary/40 bg-primary/8 px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-primary flex-shrink-0" />
                  <p className="text-xs text-foreground">
                    <span className="font-semibold">{validatedClips.length} clip{validatedClips.length !== 1 ? 's' : ''}</span> ready to preview
                  </p>
                </div>
                <button
                  onClick={() => setShowPartialPreview(v => !v)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold"
                >
                  {showPartialPreview ? 'Close' : 'Preview Video'}
                </button>
              </div>
            );
          })()}

          {/* Partial preview panel */}
          <AnimatePresence>
            {showPartialPreview && isProcessing && (() => {
              const validatedClips = (activeJob.clip_results || []).filter(c =>
                c.image_url && (
                  c.clip_type === 'static' ||
                  (c.clip_type === 'animated' && c.veo_diagnostics?.source_image_url && c.veo_diagnostics?.avatar_reference_url)
                )
              );
              if (validatedClips.length === 0) return null;
              return (
                <motion.div
                  key="partial-preview"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-2xl border border-primary/30 bg-primary/5 overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2 border-b border-primary/20">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                      <span className="text-xs font-semibold text-primary">Previewing partial reel</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Rest still generating…</p>
                  </div>
                  <div className="p-3">
                    <ReelPlayer clips={validatedClips} autoPlay={false} />
                  </div>
                </motion.div>
              );
            })()}
          </AnimatePresence>

          {/* In-progress status card */}
          {isProcessing && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{statusInfo.label}</p>
                  {activeJob.estimated_time_remaining && activeJob.estimated_time_remaining !== '0' && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Est. {activeJob.estimated_time_remaining} remaining
                    </p>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <motion.div
                  animate={{ width: `${activeJob.progress_percent || 0}%` }}
                  transition={{ duration: 0.6 }}
                  className="h-full bg-primary rounded-full"
                />
              </div>

              {/* Per-clip identity diagnostic panel */}
              {clips.length > 0 && (
                <div className="space-y-2">
                  {clips.map((clip, i) => {
                    const hasFail = clip.status?.startsWith('failed') || clip.status?.startsWith('identity_fail') || clip.status?.startsWith('veo_error');
                    const hasAvatar = clip.veo_diagnostics?.avatar_reference_url;
                    const hasSource = clip.veo_diagnostics?.source_image_url || clip.image_url;
                    return (
                      <div key={i} className={`rounded-xl border px-3 py-2 flex items-start gap-2 text-[10px] ${hasFail ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-secondary/30'}`}>
                        {clip.image_url && (
                          <img src={clip.image_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-semibold ${hasFail ? 'text-destructive' : 'text-foreground'}`}>Clip {i + 1}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${hasFail ? 'bg-destructive/20 text-destructive' : clip.clip_type === 'animated' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                              {clip.status || clip.clip_type}
                            </span>
                          </div>
                          <div className="text-muted-foreground space-y-0.5">
                            <div>Source: {hasSource ? <span className="text-emerald-400">✓ set</span> : <span className="text-destructive">✗ missing</span>}</div>
                            <div>Avatar: {hasAvatar ? <span className="text-emerald-400">✓ set</span> : <span className="text-amber-400">✗ missing</span>}</div>
                            <div>Video: {clip.clip_url ? <span className="text-emerald-400">✓ generated</span> : <span className="text-muted-foreground">—</span>}</div>
                            {hasFail && clip.error && (
                              <div className="text-destructive mt-1 leading-tight">{clip.error.slice(0, 120)}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-[10px] text-muted-foreground/60 text-center">
                You can navigate away and return — this job continues in the background
              </p>

              {/* Job controls: Cancel + Restart */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowRestartConfirm(true)}
                  disabled={restarting || cancelling}
                  className="flex-1 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Restart Generation
                </button>
                <button
                  onClick={handleCancel}
                  disabled={cancelling || restarting}
                  className="flex-1 py-2 rounded-xl border border-destructive/40 text-destructive text-xs hover:bg-destructive/5 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5" />}
                  Cancel Generation
                </button>
              </div>
            </div>
          )}

          {/* Failure state */}
          {isFailed && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-destructive">Reel generation failed</p>
                  <p className="text-xs text-muted-foreground mt-1">{activeJob.error_message || "An error occurred."}</p>
                </div>
              </div>
              {(activeJob.validation_notes || []).length > 0 && (
                <div className="space-y-1">
                  {activeJob.validation_notes.map((n, i) => (
                    <p key={i} className="text-[10px] text-muted-foreground flex items-start gap-1">
                      <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-0.5 text-amber-400" /> {n}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={handleRetry} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4" /> Retry
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="py-2.5 px-4 rounded-xl border border-destructive/40 text-destructive text-sm flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Discard
                </button>
              </div>
            </div>
          )}

          {/* Cancelled state */}
          {isCancelled && (
            <div className="rounded-2xl border border-border bg-secondary/30 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <StopCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Generation cancelled</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your selected photos, captions, and settings were preserved. No original images or media records were changed.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowRestartConfirm(true)}
                  disabled={restarting}
                  className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {restarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Start Again
                </button>
                <button
                  onClick={handleEditSelection}
                  className="w-full py-2.5 rounded-xl border border-border text-sm text-foreground flex items-center justify-center gap-2 hover:border-primary/40 transition-colors"
                >
                  <Edit3 className="w-4 h-4" /> Edit Selection
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full py-2.5 rounded-xl border border-destructive/30 text-destructive text-sm flex items-center justify-center gap-2 hover:bg-destructive/5 transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Delete Draft
                </button>
              </div>
            </div>
          )}

          {/* Complete: Reel Player + actions */}
          {isComplete && clips.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Your Memory Reel is Ready</h3>
              </div>

              {/* Source-locked reel player */}
              <ReelPlayer clips={clips} autoPlay={false} />

              {/* Source validation notes */}
              {(activeJob.validation_notes || []).filter(n => n.startsWith('WARN')).length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-1">
                  {activeJob.validation_notes.filter(n => n.startsWith('WARN')).map((n, i) => (
                    <p key={i} className="text-[10px] text-amber-400 flex items-start gap-1">
                      <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" /> {n.replace('WARN: ', '')}
                    </p>
                  ))}
                </div>
              )}

              {/* Send status feedback */}
              {sendStatus === 'sent' && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-400 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4" /> Reel sent to character!
                </div>
              )}
              {sendStatus === 'error' && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Send failed. Please try again.
                </div>
              )}

              {/* Actions */}
              <div className="grid grid-cols-3 gap-2">
                <a
                  href={activeJob.thumbnail_url || "#"}
                  download="memory_reel_thumb.jpg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Save
                </a>
                <button
                  onClick={() => { setSendStatus(null); setShowCharPicker(true); }}
                  disabled={sendStatus === 'sending'}
                  className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-secondary border border-border text-foreground text-xs font-medium hover:border-primary/40 transition-colors disabled:opacity-50"
                >
                  {sendStatus === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-secondary border border-border text-foreground text-xs font-medium hover:border-destructive/40 hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>

              <p className="text-[10px] text-muted-foreground/60 text-center">
                {clips.length} image{clips.length !== 1 ? "s" : ""} · {clips.filter(c => c.clip_type === 'animated').length} animated · source-locked
              </p>
            </div>
          )}

          {/* New reel button */}
          {(isComplete || isFailed) && (
            <button
              onClick={() => { setActiveJob(null); }}
              className="w-full py-3 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Start a new reel
            </button>
          )}

        </div>

        {/* Restart confirm modal */}
        <AnimatePresence>
          {showRestartConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowRestartConfirm(false)}>
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-sm bg-card border border-border rounded-2xl p-5 space-y-4"
              >
                <div className="flex items-start gap-3">
                  <RefreshCw className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Restart reel generation?</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      The current render will stop, but your selected photos and settings will stay.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowRestartConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Keep going
                  </button>
                  <button
                    onClick={handleRestart}
                    disabled={restarting}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {restarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Restart
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Character picker */}
        <AnimatePresence>
          {showCharPicker && (
            <CharacterPicker
              characters={characters}
              onSelect={handleSendToCharacter}
              onClose={() => setShowCharPicker(false)}
            />
          )}
        </AnimatePresence>

        {/* Delete confirm */}
        <AnimatePresence>
          {showDeleteConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowDeleteConfirm(false)}>
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-sm bg-card border border-border rounded-2xl p-5 space-y-4"
              >
                <div className="flex items-start gap-3">
                  <Trash2 className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Delete this memory reel?</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This removes the generated reel job and clips. Original images, memories, and characters are never deleted. Sent messages are not removed.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
                  <button onClick={handleDeleteReel} disabled={deleting} className="flex-1 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Delete
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── EDITOR: media selection ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-50">
        <Link to="/moments" className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-foreground">Memory Reel Creator</h1>
          <p className="text-xs text-muted-foreground">Past Month · {mediaItems.length} images · {selectedItems.length} selected</p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">

        {loadError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {loadError}
          </div>
        )}

        {jobError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {jobError}
          </div>
        )}

        {/* Character filter pills */}
        {filterChars.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setCharFilter("all")}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${charFilter === "all" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
            >
              All
            </button>
            {filterChars.map(c => (
              <button
                key={c.id}
                onClick={() => setCharFilter(c.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${charFilter === c.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
              >
                {c.avatar_url && <img src={c.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />}
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Media grid */}
        {mediaItems.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-2">
            <Image className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium text-foreground">No images found in the past month</p>
            <p className="text-xs text-muted-foreground">Media Grid images from character chats will appear here.</p>
          </div>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">📸 Select Images</h2>
              <div className="flex gap-2">
                <button onClick={() => setMediaItems(prev => prev.map(m => ({ ...m, included: true })))} className="text-[10px] text-primary hover:underline">Select all</button>
                <span className="text-[10px] text-muted-foreground">·</span>
                <button onClick={() => setMediaItems(prev => prev.map(m => ({ ...m, included: false })))} className="text-[10px] text-muted-foreground hover:underline">Clear</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {filteredItems.map(item => (
                <ImageCard
                  key={item.id}
                  item={item}
                  onToggle={toggleInclude}
                  onAnimateToggle={toggleAnimate}
                  onCaptionChange={setCaption}
                />
              ))}
            </div>
          </section>
        )}

        {/* Memory highlights */}
        {memories.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">💭 Memory Highlights</h2>
            <div className="space-y-2">
              {memories.slice(0, 4).map((mem, i) => (
                <div key={mem.id || i} className="rounded-xl bg-secondary/40 border border-border px-3 py-2.5 text-xs">
                  <p className="text-foreground/80 line-clamp-2">{mem.memory_summary || mem.memory_text?.slice(0, 100)}</p>
                  <p className="text-muted-foreground/60 mt-1">{new Date(mem.created_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Selected reel preview strip */}
        {selectedItems.length > 0 && (
          <section className="rounded-2xl border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-semibold text-primary">🎬 Reel — {selectedItems.length} image{selectedItems.length !== 1 ? "s" : ""} · {selectedItems.filter(i => i.animate).length} to animate</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {selectedItems.map(item => (
                <div key={item.id} className="flex-shrink-0 relative">
                  <img src={item.image_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
                  {item.animate && item.full_prompt && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                      <Zap className="w-2.5 h-2.5 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              ⚡ = animate (image-to-video, source-locked) · no icon = static photo slide
            </p>
          </section>
        )}
      </div>

      {/* Sticky Create Vid button */}
      <div className="fixed bottom-4 left-4 right-4 z-40">
        <button
          onClick={handleGenerate}
          disabled={selectedItems.length === 0 || jobSubmitting}
          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-40 shadow-lg shadow-primary/30"
        >
          {jobSubmitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
            : <><Sparkles className="w-4 h-4" /> Create Vid{selectedItems.length > 0 ? ` (${selectedItems.length} images)` : ""}</>
          }
        </button>
        {selectedItems.length === 0 && (
          <p className="text-center text-[10px] text-muted-foreground mt-2">Select at least one image</p>
        )}
      </div>
    </div>
  );
}