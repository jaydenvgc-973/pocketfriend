import React, { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Film, Play, Download, Send, Trash2, Sparkles, Camera,
  CheckSquare, Square, Zap, AlertTriangle, Loader2, X, ChevronDown,
  ChevronUp, User, Image, FileText
} from "lucide-react";

const TRANSITION_OPTIONS = ["slide", "fade", "zoom", "pan"];

// Progress step labels
const PROGRESS_STEPS = [
  "Preparing images",
  "Animating selected moments",
  "Building reel",
  "Finalizing download",
];

function ImageCard({ item, onToggle, onAnimateToggle, onCaptionChange }) {
  const [showCaption, setShowCaption] = useState(false);
  const included = item.included;
  const animate = item.animate;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-2xl border overflow-hidden transition-all ${
        included ? "border-primary/60 bg-primary/5" : "border-border bg-card"
      }`}
    >
      {/* Image */}
      <div className="relative aspect-square">
        <img
          src={item.image_url}
          alt={item.character_name || "Memory"}
          className="w-full h-full object-cover"
        />
        {/* Include checkbox overlay */}
        <button
          onClick={() => onToggle(item.id)}
          className="absolute top-2 left-2 p-1 rounded-lg bg-black/50 hover:bg-black/70 transition-colors"
        >
          {included
            ? <CheckSquare className="w-4 h-4 text-primary" />
            : <Square className="w-4 h-4 text-white/80" />
          }
        </button>
        {/* Animate badge */}
        {included && (
          <button
            onClick={() => onAnimateToggle(item.id)}
            className={`absolute top-2 right-2 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1 ${
              animate
                ? "bg-primary text-primary-foreground"
                : "bg-black/50 text-white/70 hover:bg-black/70"
            }`}
          >
            <Zap className="w-2.5 h-2.5" />
            {animate ? "Animate" : "Static"}
          </button>
        )}
      </div>

      {/* Meta */}
      <div className="p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5">
          {item.avatar_url && (
            <img src={item.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
          )}
          <p className="text-xs font-medium text-foreground truncate">{item.character_name || "Unknown"}</p>
          <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
            {item.date_label}
          </span>
        </div>

        {item.prompt_preview && (
          <p className="text-[10px] text-muted-foreground/70 italic line-clamp-2">
            "{item.prompt_preview}"
          </p>
        )}
        {!item.prompt_preview && (
          <p className="text-[10px] text-amber-400/70 flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" /> No prompt — static slide only
          </p>
        )}

        {/* Caption toggle */}
        {included && (
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
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary transition-colors text-left ${
                picked?.id === c.id ? "bg-primary/10" : ""
              }`}
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

export default function MemoryReelCreator() {
  const [activated, setActivated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mediaItems, setMediaItems] = useState([]); // all fetched media
  const [charFilter, setCharFilter] = useState("all");
  const [memories, setMemories] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [generating, setGenerating] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [progressWarnings, setProgressWarnings] = useState([]);
  const [reelResult, setReelResult] = useState(null); // { video_url, thumbnail_url, reel_id }

  const [showCharPicker, setShowCharPicker] = useState(false);
  const [sendStatus, setSendStatus] = useState(null); // null | 'sending' | 'sent' | 'error'
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  // Derive unique character IDs from loaded media for filter pills
  const mediaCharIds = [...new Set(mediaItems.map(m => m.character_id).filter(Boolean))];
  const filterChars = characters.filter(c => mediaCharIds.includes(c.id));

  const selectedItems = mediaItems.filter(m => m.included);
  const filteredItems = charFilter === "all"
    ? mediaItems
    : mediaItems.filter(m => m.character_id === charFilter);

  // ── ACTIVATION: load last 14 days of media + memories ────────────────────
  const handleActivate = useCallback(async () => {
    if (!currentUser?.email) return;
    setActivated(true);
    setLoading(true);
    setLoadError(null);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffISO = cutoff.toISOString();

    try {
      // Load recent messages with images (media grid source)
      // Message has no owner_email — scoped by conversation via platform RLS.
      // We filter by created_date client-side after fetching.
      const [recentMessages, recentMemories] = await Promise.all([
        base44.entities.Message.filter({ sender_type: "character" }, "-created_date", 200).catch(() => []),
        base44.entities.CharacterMemory.filter(
          { character_id: characters.map(c => c.id) },
          "-created_date", 100
        ).catch(() => []),
      ]);

      // Filter to last 14 days and only image messages
      const charById = Object.fromEntries(characters.map(c => [c.id, c]));

      const rawMedia = recentMessages
        .filter(m => m.image_url && m.created_date >= cutoffISO)
        .slice(0, 30);

      // Deduplicate by image_url
      const seenUrls = new Set();
      const dedupedMedia = rawMedia.filter(m => {
        if (seenUrls.has(m.image_url)) return false;
        seenUrls.add(m.image_url);
        return true;
      });

      // Build media items
      const items = dedupedMedia.slice(0, 20).map(m => {
        const char = charById[m.character_id] || null;
        const genCtx = m.generation_context || {};
        const prompt = genCtx.prompt || null;
        const dateLabel = new Date(m.created_date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return {
          id: m.id,
          message_id: m.id,
          image_url: m.image_url,
          character_id: m.character_id || null,
          character_name: char?.name || m.character_name || "Unknown",
          avatar_url: char?.avatar_url || null,
          prompt_preview: prompt ? prompt.slice(0, 120) : null,
          full_prompt: prompt || null,
          date_label: dateLabel,
          created_date: m.created_date,
          included: true,
          animate: !!(prompt), // default: animate only if prompt exists
          caption: "",
          transition: "slide",
        };
      });

      // Filter memories to last 14 days
      const filteredMemories = recentMemories
        .filter(mem => mem.created_date >= cutoffISO)
        .slice(0, 15);

      setMediaItems(items);
      setMemories(filteredMemories);
    } catch (err) {
      console.error('[MemoryReelCreator] load failed:', err?.message);
      setLoadError(err?.message || "Failed to load media. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.email, characters]);

  const toggleInclude = (id) => {
    setMediaItems(prev => prev.map(m => m.id === id ? { ...m, included: !m.included } : m));
  };

  const toggleAnimate = (id) => {
    setMediaItems(prev => prev.map(m => m.id === id ? { ...m, animate: !m.animate } : m));
  };

  const setCaption = (id, caption) => {
    setMediaItems(prev => prev.map(m => m.id === id ? { ...m, caption } : m));
  };

  // ── GENERATE REEL ─────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    const toInclude = mediaItems.filter(m => m.included);
    if (toInclude.length === 0 || generating) return;

    setGenerating(true);
    setProgressStep(0);
    setProgressWarnings([]);
    setReelResult(null);

    const warnings = [];

    try {
      // Step 0: Preparing
      setProgressStep(0);
      await new Promise(r => setTimeout(r, 600));

      // Step 1: Animate selected moments
      setProgressStep(1);
      const animatedClips = [];
      for (const item of toInclude) {
        if (item.animate && item.full_prompt) {
          try {
            // Build animation prompt preserving character identity
            const animPrompt = `${item.full_prompt} — add subtle natural motion: ${
              ["a gentle smile spreading across their face",
               "slowly turning their head to look around",
               "natural breathing and slight body movement",
               "soft environmental motion in the background",
               "gentle camera drift and natural light shift"][Math.floor(Math.random() * 5)]
            }. Preserve exact character appearance, clothing, setting, and mood. Vertical 9:16 format. No sudden cuts. Smooth motion only.`;

            const result = await base44.integrations.Core.GenerateVideo({
              prompt: animPrompt,
              duration: 4,
              aspect_ratio: "9:16",
            });
            animatedClips.push({
              ...item,
              clip_url: result?.url || null,
              clip_type: result?.url ? "animated" : "static",
            });
          } catch (err) {
            warnings.push(`Animation failed for "${item.character_name}" image (${item.date_label}) — using static slide.`);
            animatedClips.push({ ...item, clip_url: null, clip_type: "static" });
          }
        } else {
          animatedClips.push({ ...item, clip_url: null, clip_type: "static" });
        }
      }

      if (warnings.length > 0) setProgressWarnings([...warnings]);

      // Step 2: Building reel
      setProgressStep(2);
      await new Promise(r => setTimeout(r, 800));

      // Build a memory reel description for the AI video generator
      // We use the static images as the reference input
      const staticRefs = animatedClips
        .filter(c => c.clip_type === "static")
        .map(c => c.image_url)
        .slice(0, 4);

      const captionLines = animatedClips
        .filter(c => c.caption)
        .map(c => `• ${c.caption}`)
        .join(" | ");

      const charNames = [...new Set(animatedClips.map(c => c.character_name))].join(", ");
      const memoryHighlights = memories
        .slice(0, 5)
        .map(m => m.memory_summary || m.memory_text?.slice(0, 80))
        .filter(Boolean)
        .join(" | ");

      const reelPrompt = `Create a vertical Instagram Reel / TikTok memory montage (9:16 format, 15-30 seconds). 
Characters featured: ${charNames}.
${memoryHighlights ? `Memory highlights: ${memoryHighlights}` : ""}
${captionLines ? `Captions: ${captionLines}` : ""}
Style: warm, cinematic memory montage with smooth slide/fade transitions between moments.
Maintain consistent character appearances throughout. Natural lighting, authentic moments.
Text overlays: minimal, readable. Do not rush transitions. Emotional, personal feel.
Do not change character identities, ages, or appearances between clips.`;

      const reelVideo = await base44.integrations.Core.GenerateVideo({
        prompt: reelPrompt,
        duration: 6,
        aspect_ratio: "9:16",
        existing_image_urls: staticRefs.length > 0 ? staticRefs : undefined,
      });

      // Step 3: Finalizing
      setProgressStep(3);
      await new Promise(r => setTimeout(r, 500));

      // Use first static image as thumbnail
      const thumbnailUrl = toInclude[0]?.image_url || null;

      // Store a lightweight record of the generated reel
      const reelRecord = await base44.entities.Message.create({
        sender_type: "user",
        content: `[Memory Reel] ${charNames} — ${new Date().toLocaleDateString()}`,
        image_url: thumbnailUrl,
        timestamp: new Date().toISOString(),
        generation_context: {
          prompt: reelPrompt,
          subject_type: "memory_reel",
          reel_video_url: reelVideo?.url || null,
          related_character_ids: [...new Set(toInclude.map(i => i.character_id).filter(Boolean))],
          source: "moments_memory_reel_creator",
          created_at: new Date().toISOString(),
        },
      }).catch(() => null);

      setReelResult({
        video_url: reelVideo?.url || null,
        thumbnail_url: thumbnailUrl,
        reel_record_id: reelRecord?.id || null,
        char_names: charNames,
        included_items: toInclude,
        warnings,
      });
    } catch (err) {
      console.error('[MemoryReelCreator] generation failed:', err?.message);
      setProgressWarnings(prev => [...prev, `Generation failed: ${err?.message || "Unknown error"}`]);
    } finally {
      setGenerating(false);
    }
  };

  // ── SEND TO CHARACTER ─────────────────────────────────────────────────────
  const handleSendToCharacter = async (char, caption) => {
    if (!reelResult?.video_url || !currentUser?.email) return;
    setShowCharPicker(false);
    setSendStatus('sending');

    try {
      // Find or create a conversation with this character
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

      const relatedCharIds = [...new Set(reelResult.included_items.map(i => i.character_id).filter(Boolean))];
      const relatedMemIds = memories.slice(0, 5).map(m => m.id).filter(Boolean);

      // Send the reel as a message
      await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "user",
        content: caption || `I made a memory reel featuring ${reelResult.char_names}! 🎬✨`,
        image_url: reelResult.thumbnail_url || null,
        timestamp: new Date().toISOString(),
        generation_context: {
          prompt: caption || "",
          subject_type: "memory_reel",
          reel_video_url: reelResult.video_url,
          thumbnail_url: reelResult.thumbnail_url,
          sender_user_id: currentUser.id,
          recipient_character_id: char.id,
          owner_email: currentUser.email,
          media_type: "memory_reel",
          related_memory_ids: relatedMemIds,
          related_character_ids: relatedCharIds,
          source: "moments_memory_reel_creator",
          created_at: new Date().toISOString(),
        },
      });

      // Write a lightweight memory to the character
      const memText = `${currentUser.full_name || "The user"} sent me a memory reel they created on ${new Date().toLocaleDateString()}. It featured ${reelResult.char_names}. ${caption ? `They wrote: "${caption}"` : ""}`;
      await base44.entities.CharacterMemory.create({
        character_id: char.id,
        memory_type: "event",
        memory_text: memText,
        memory_summary: `Received a memory reel from the user featuring ${reelResult.char_names}.`,
        importance_score: 7,
        confidence_score: 1.0,
        permanence: "long_term",
        validation_status: "confirmed",
      }).catch(() => {});

      setSendStatus('sent');
    } catch (err) {
      console.error('[MemoryReelCreator] send failed:', err?.message);
      setSendStatus('error');
    }
  };

  // ── DELETE REEL ───────────────────────────────────────────────────────────
  const handleDeleteReel = async () => {
    if (!reelResult) return;
    setDeleting(true);
    try {
      if (reelResult.reel_record_id) {
        await base44.entities.Message.delete(reelResult.reel_record_id).catch(() => {});
      }
      setReelResult(null);
      setShowDeleteConfirm(false);
      setProgressWarnings([]);
      setProgressStep(0);
    } finally {
      setDeleting(false);
    }
  };

  // ── INACTIVE START SCREEN ────────────────────────────────────────────────
  if (!activated) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-50">
          <Link to="/moments" className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-sm font-bold text-foreground">Memory Reel Creator</h1>
            <p className="text-xs text-muted-foreground">Instagram Reel / TikTok style memory video</p>
          </div>
        </div>

        {/* Inactive start screen */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto">
              <Film className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Memory Reel Creator</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
                Turn your recent character moments and images into a short vertical memory video — Instagram Reel / TikTok style.
              </p>
            </div>
          </div>

          <div className="w-full max-w-xs space-y-3 text-xs text-muted-foreground">
            {[
              { icon: Camera, text: "Uses media from the past 14 days" },
              { icon: Sparkles, text: "Animates selected images with AI" },
              { icon: Film, text: "Generates a vertical 9:16 reel" },
              { icon: Send, text: "Send directly to a character" },
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
              <p className="text-[10px] text-muted-foreground text-center">You need at least one active character to use this feature.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── ACTIVE: LOADING STATE ────────────────────────────────────────────────
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
          <p className="text-xs text-muted-foreground/60">Scanning the past 14 days</p>
        </div>
      </div>
    );
  }

  // ── ACTIVE: MAIN EDITOR ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-50">
        <Link to="/moments" className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-foreground">Memory Reel Creator</h1>
          <p className="text-xs text-muted-foreground">Past 14 days · {mediaItems.length} images found</p>
        </div>
        <span className="text-xs text-primary font-medium">
          {selectedItems.length} selected
        </span>
      </div>

      <div className="px-4 py-4 space-y-6">

        {/* Load error */}
        {loadError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {loadError}
          </div>
        )}

        {/* Character filter */}
        {filterChars.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setCharFilter("all")}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                charFilter === "all" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              }`}
            >
              All
            </button>
            {filterChars.map(c => (
              <button
                key={c.id}
                onClick={() => setCharFilter(c.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  charFilter === c.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                }`}
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
            <p className="text-sm font-medium text-foreground">No images found in the past 14 days</p>
            <p className="text-xs text-muted-foreground">Media Grid images from character chats will appear here.</p>
          </div>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                📸 Select Images
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setMediaItems(prev => prev.map(m => ({ ...m, included: true })))}
                  className="text-[10px] text-primary hover:underline"
                >
                  Select all
                </button>
                <span className="text-[10px] text-muted-foreground">·</span>
                <button
                  onClick={() => setMediaItems(prev => prev.map(m => ({ ...m, included: false })))}
                  className="text-[10px] text-muted-foreground hover:underline"
                >
                  Clear
                </button>
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

        {/* Memory highlights panel */}
        {memories.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              💭 Memory Highlights (past 14 days)
            </h2>
            <div className="space-y-2">
              {memories.slice(0, 5).map((mem, i) => (
                <div key={mem.id || i} className="rounded-xl bg-secondary/40 border border-border px-3 py-2.5 text-xs">
                  <p className="text-foreground/80 line-clamp-2">{mem.memory_summary || mem.memory_text?.slice(0, 100)}</p>
                  <p className="text-muted-foreground/60 mt-1">{new Date(mem.created_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Selected reel items summary */}
        {selectedItems.length > 0 && !reelResult && (
          <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-2">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider">🎬 Your Reel</h3>
            <p className="text-xs text-muted-foreground">{selectedItems.length} image{selectedItems.length !== 1 ? "s" : ""} · {selectedItems.filter(i => i.animate).length} animated</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {selectedItems.map(item => (
                <div key={item.id} className="flex-shrink-0 relative">
                  <img src={item.image_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
                  {item.animate && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                      <Zap className="w-2.5 h-2.5 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Progress warnings */}
        {progressWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-1">
            {progressWarnings.map((w, i) => (
              <p key={i} className="text-[10px] text-amber-400 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" /> {w}
              </p>
            ))}
          </div>
        )}

        {/* Generating state */}
        {generating && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">{PROGRESS_STEPS[progressStep]}</p>
              <p className="text-xs text-muted-foreground mt-1">Step {progressStep + 1} of {PROGRESS_STEPS.length}</p>
            </div>
            <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
              <motion.div
                animate={{ width: `${((progressStep + 1) / PROGRESS_STEPS.length) * 100}%` }}
                transition={{ duration: 0.5 }}
                className="h-full bg-primary rounded-full"
              />
            </div>
            <p className="text-[10px] text-muted-foreground/60">This may take 30–90 seconds</p>
          </div>
        )}

        {/* Result panel */}
        {reelResult && !generating && (
          <div className="rounded-2xl border border-primary/40 bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Film className="w-5 h-5 text-primary" />
              <h3 className="text-sm font-bold text-foreground">Your Memory Reel is Ready</h3>
            </div>

            {/* Video preview */}
            {reelResult.video_url ? (
              <video
                src={reelResult.video_url}
                controls
                playsInline
                className="w-full rounded-xl aspect-[9/16] object-cover bg-black"
                style={{ maxHeight: "60vh" }}
              />
            ) : reelResult.thumbnail_url ? (
              <div className="relative">
                <img src={reelResult.thumbnail_url} alt="Reel thumbnail" className="w-full rounded-xl aspect-[9/16] object-cover" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="px-4 py-2 rounded-xl bg-black/60 text-white text-xs text-center">
                    Video generation completed — use Download to save
                  </div>
                </div>
              </div>
            ) : null}

            {/* Send status feedback */}
            {sendStatus === 'sent' && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-400 flex items-center gap-2">
                <CheckSquare className="w-4 h-4" /> Reel sent to character! They'll remember it.
              </div>
            )}
            {sendStatus === 'error' && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Send failed. Please try again.
              </div>
            )}

            {/* Actions */}
            <div className="grid grid-cols-3 gap-2">
              {/* Download */}
              {reelResult.video_url ? (
                <a
                  href={reelResult.video_url}
                  download="memory_reel.mp4"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
              ) : (
                <button
                  disabled
                  className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-secondary text-muted-foreground text-xs font-medium opacity-50"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
              )}

              {/* Send to Character */}
              <button
                onClick={() => { setSendStatus(null); setShowCharPicker(true); }}
                disabled={sendStatus === 'sending'}
                className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-secondary border border-border text-foreground text-xs font-medium hover:border-primary/40 transition-colors disabled:opacity-50"
              >
                {sendStatus === 'sending'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Send className="w-4 h-4" />
                }
                Send
              </button>

              {/* Delete */}
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-secondary border border-border text-foreground text-xs font-medium hover:border-destructive/40 hover:text-destructive transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>

            <p className="text-[10px] text-muted-foreground/60 text-center">
              Deleting the reel does not delete your original images or memories.
            </p>
          </div>
        )}

        {/* Create Vid button */}
        {!reelResult && !generating && (
          <div className="fixed bottom-4 left-4 right-4 z-40">
            <button
              onClick={handleGenerate}
              disabled={selectedItems.length === 0 || generating}
              className="w-full py-4 rounded-2xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-40 shadow-lg shadow-primary/30"
            >
              <Sparkles className="w-4 h-4" />
              Create Vid{selectedItems.length > 0 ? ` (${selectedItems.length} images)` : ""}
            </button>
            {selectedItems.length === 0 && (
              <p className="text-center text-[10px] text-muted-foreground mt-2">Select at least one image to create your reel</p>
            )}
          </div>
        )}
      </div>

      {/* Character picker modal */}
      <AnimatePresence>
        {showCharPicker && (
          <CharacterPicker
            characters={characters.filter(c => c.owner_email === currentUser?.email || c.status === 'active')}
            onSelect={handleSendToCharacter}
            onClose={() => setShowCharPicker(false)}
          />
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
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
                    This will remove the generated video file, but it will not delete the original images, memories, or characters.
                    If you already sent this reel to a character, their message thread will not be deleted.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteReel}
                  disabled={deleting}
                  className="flex-1 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete Reel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}