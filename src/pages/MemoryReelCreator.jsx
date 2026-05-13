/**
 * MemoryReelCreator
 *
 * Simple, stable memory reel generation flow:
 * 1. Load images from past 1 month
 * 2. User selects images
 * 3. Create ReelGenerationJob
 * 4. Poll job status until complete
 * 5. Show ReelPlayer with generated clips
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Film, Play, Download, Send, Trash2, Sparkles, Camera,
  CheckSquare, Square, Loader2, X, ChevronDown, ChevronUp, Image,
  RefreshCw, StopCircle, AlertTriangle
} from "lucide-react";
import ReelPlayer from "@/components/moments/ReelPlayer";

const STATUS_LABELS = {
  queued:     "Queued",
  preparing:  "Preparing images",
  animating:  "Generating videos",
  assembling: "Assembling reel",
  complete:   "Complete",
  failed:     "Failed",
  cancelled:  "Cancelled",
};

const POLL_INTERVAL = 4000; // ms

function ImageCard({ item, onToggle, onCaptionChange }) {
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
      </div>

      <div className="p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5">
          {item.avatar_url && (
            <img src={item.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
          )}
          <p className="text-xs font-medium text-foreground truncate">{item.character_name || "Unknown"}</p>
          <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">{item.date_label}</span>
        </div>

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
                className="mt-1 w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 outline-none border border-transparent focus:border-primary/50"
              />
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

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
            className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50"
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

export default function MemoryReelCreator() {
  const [activated, setActivated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mediaItems, setMediaItems] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [jobSubmitting, setJobSubmitting] = useState(false);
  const [jobError, setJobError] = useState(null);
  const [showCharPicker, setShowCharPicker] = useState(false);
  const [sendStatus, setSendStatus] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pollTimerRef = useRef(null);

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

  // Check for existing job on mount
  useEffect(() => {
    if (!currentUser?.email) return;
    base44.entities.ReelGenerationJob
      .filter({ owner_email: currentUser.email }, "-created_date", 1)
      .then(jobs => {
        const live = jobs.find(j => !['failed', 'cancelled'].includes(j.status));
        if (live) {
          setActiveJob(live);
          setActivated(true);
          if (['queued', 'preparing', 'animating', 'assembling'].includes(live.status)) {
            startPolling(live.id);
          }
        }
      })
      .catch(() => {});
  }, [currentUser?.email]);

  const startPolling = useCallback((jobId) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      try {
        const jobs = await base44.entities.ReelGenerationJob.filter({ owner_email: currentUser?.email });
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

  const handleActivate = useCallback(async () => {
    if (!currentUser?.email) return;
    setActivated(true);
    setLoading(true);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30); // 1 month
    const cutoffISO = cutoff.toISOString();

    try {
      const messages = await base44.entities.Message.filter({ sender_type: "character" }, "-created_date", 300).catch(() => []);
      const charById = Object.fromEntries(characters.map(c => [c.id, c]));
      const ownedCharIds = new Set(characters.map(c => c.id));

      const rawMedia = messages.filter(m =>
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
        return {
          id: m.id,
          message_id: m.id,
          image_url: m.image_url,
          character_id: m.character_id || null,
          character_name: char?.name || m.character_name || "Unknown",
          avatar_url: char?.avatar_url || null,
          date_label: new Date(m.created_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          created_date: m.created_date,
          included: true,
          caption: "",
        };
      });

      setMediaItems(items);
    } catch (err) {
      setJobError("Failed to load media. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.email, characters]);

  const toggleInclude = (id) => setMediaItems(prev => prev.map(m => m.id === id ? { ...m, included: !m.included } : m));
  const setCaption = (id, caption) => setMediaItems(prev => prev.map(m => m.id === id ? { ...m, caption } : m));

  const selectedItems = mediaItems.filter(m => m.included);

  const handleGenerate = async () => {
    if (selectedItems.length === 0 || jobSubmitting) return;
    setJobSubmitting(true);
    setJobError(null);

    try {
      const charNames = [...new Set(selectedItems.map(i => i.character_name))].join(", ");

      const job = await base44.entities.ReelGenerationJob.create({
        owner_email: currentUser.email,
        status: 'queued',
        progress_percent: 0,
        selected_image_ids: selectedItems.map(i => i.id),
        selected_image_urls: selectedItems.map(i => i.image_url),
        selected_character_ids: [...new Set(selectedItems.map(i => i.character_id).filter(Boolean))],
        clip_results: [],
        char_names: charNames,
        thumbnail_url: selectedItems[0]?.image_url || null,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      setActiveJob(job);
      startPolling(job.id);

      base44.functions.invoke('processReelGenerationJob', { job_id: job.id }).catch(() => {});
    } catch (err) {
      setJobError(err?.message || "Failed to start generation.");
    } finally {
      setJobSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeJob || cancelling) return;
    setCancelling(true);
    try {
      await base44.entities.ReelGenerationJob.update(activeJob.id, {
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      });
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      const refreshed = await base44.entities.ReelGenerationJob.filter({ owner_email: currentUser.email });
      const job = refreshed.find(j => j.id === activeJob.id);
      if (job) setActiveJob(job);
    } finally {
      setCancelling(false);
    }
  };

  const handleDeleteReel = async () => {
    if (!activeJob) return;
    setDeleting(true);
    try {
      await base44.entities.ReelGenerationJob.delete(activeJob.id);
      setActiveJob(null);
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleSendToCharacter = async (char, caption) => {
    if (!activeJob?.clip_results?.length) return;
    setShowCharPicker(false);
    setSendStatus('sending');

    try {
      const convos = await base44.entities.Conversation.filter(
        { character_ids: [char.id], owner_email: currentUser.email },
        "-updated_date", 1
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
        content: caption || `I made a memory reel with you! 🎬✨`,
        timestamp: new Date().toISOString(),
      });

      setSendStatus('sent');
    } catch (err) {
      setSendStatus('error');
    }
  };

  // Inactive start screen
  if (!activated) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-50">
          <Link to="/moments" className="p-2 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-sm font-bold text-foreground">Memory Reel Creator</h1>
            <p className="text-xs text-muted-foreground">Instagram Reel / TikTok style</p>
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
                Turn your recent character moments into a TikTok / Instagram Reel-style montage.
              </p>
            </div>
          </div>

          <button
            onClick={handleActivate}
            disabled={!currentUser?.email}
            className="w-full max-w-xs py-3.5 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            Start Building Reel
          </button>
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Loading your memories…</p>
      </div>
    );
  }

  // Active job state
  if (activeJob) {
    const isProcessing = ['queued', 'preparing', 'animating', 'assembling'].includes(activeJob.status);
    const isComplete = activeJob.status === 'complete';
    const isFailed = activeJob.status === 'failed';
    const isCancelled = activeJob.status === 'cancelled';
    const clips = (activeJob.clip_results || []).filter(c => c.image_url);

    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-50">
          <Link to="/moments" className="p-2 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-sm font-bold text-foreground">Memory Reel Creator</h1>
            <p className="text-xs text-muted-foreground">{STATUS_LABELS[activeJob.status]}</p>
          </div>
          {isProcessing && <span className="text-xs text-primary/80 font-medium">{activeJob.progress_percent || 0}%</span>}
        </div>

        <div className="px-4 py-5 space-y-6">
          {/* In-progress */}
          {isProcessing && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{STATUS_LABELS[activeJob.status]}</p>
                </div>
              </div>
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <motion.div
                  animate={{ width: `${activeJob.progress_percent || 0}%` }}
                  transition={{ duration: 0.6 }}
                  className="h-full bg-primary rounded-full"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex-1 py-2.5 rounded-xl border border-destructive/40 text-destructive text-xs hover:bg-destructive/5 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5" />}
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Failed */}
          {isFailed && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-destructive">Generation failed</p>
                  <p className="text-xs text-muted-foreground mt-1">{activeJob.error_message || "An error occurred."}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveJob(null)}
                  className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
                >
                  Try Again
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="py-2.5 px-4 rounded-xl border border-destructive/40 text-destructive text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Cancelled */}
          {isCancelled && (
            <div className="rounded-2xl border border-border bg-secondary/30 p-5 space-y-3">
              <p className="text-sm font-semibold text-foreground">Generation cancelled</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveJob(null)}
                  className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
                >
                  Start New Reel
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="py-2.5 px-4 rounded-xl border border-border text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Complete */}
          {isComplete && clips.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Your Memory Reel is Ready</h3>
              </div>

              <ReelPlayer clips={clips} autoPlay={false} />

              {sendStatus === 'sent' && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-400 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4" /> Reel sent!
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <a
                  href={activeJob.thumbnail_url || "#"}
                  download="reel_thumb.jpg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
                >
                  <Download className="w-4 h-4" />
                  Save
                </a>
                <button
                  onClick={() => { setSendStatus(null); setShowCharPicker(true); }}
                  disabled={sendStatus === 'sending'}
                  className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-secondary border border-border text-xs font-medium hover:border-primary/40 disabled:opacity-50"
                >
                  {sendStatus === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-secondary border border-border text-xs font-medium hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>

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
                    <p className="text-sm font-semibold text-foreground">Delete reel?</p>
                    <p className="text-xs text-muted-foreground mt-1">Original images are never deleted.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm">Cancel</button>
                  <button onClick={handleDeleteReel} disabled={deleting} className="flex-1 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50">
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Editor: image selection
  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-50">
        <Link to="/moments" className="p-2 -ml-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-sm font-bold text-foreground">Memory Reel Creator</h1>
          <p className="text-xs text-muted-foreground">Past 1 Month · {mediaItems.length} images · {selectedItems.length} selected</p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {jobError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {jobError}
          </div>
        )}

        {mediaItems.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-2">
            <Image className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium text-foreground">No images found in the past month</p>
          </div>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">📸 Select Images</h2>
              <div className="flex gap-2">
                <button onClick={() => setMediaItems(prev => prev.map(m => ({ ...m, included: true })))} className="text-[10px] text-primary hover:underline">Select all</button>
                <button onClick={() => setMediaItems(prev => prev.map(m => ({ ...m, included: false })))} className="text-[10px] text-muted-foreground hover:underline">Clear</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {mediaItems.map(item => (
                <ImageCard
                  key={item.id}
                  item={item}
                  onToggle={toggleInclude}
                  onCaptionChange={setCaption}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Sticky Create button */}
      <div className="fixed bottom-4 left-4 right-4 z-40">
        <button
          onClick={handleGenerate}
          disabled={selectedItems.length === 0 || jobSubmitting}
          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-40 shadow-lg shadow-primary/30"
        >
          {jobSubmitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
            : <><Sparkles className="w-4 h-4" /> Create Vid {selectedItems.length > 0 && `(${selectedItems.length})`}</>
          }
        </button>
      </div>
    </div>
  );
}