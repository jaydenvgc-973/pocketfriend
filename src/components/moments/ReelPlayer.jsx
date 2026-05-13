/**
 * ReelPlayer — Simple vertical reel montage renderer
 * 
 * Shows static images and generated videos in a TikTok/Instagram style 9:16 gallery.
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";

const SLIDE_DURATION = 3000; // ms per static slide

function SlideFrame({ clip, index, isActive, onEnded }) {
  const videoRef = useRef(null);
  const isVideo = clip.clip_type === 'animated' && clip.clip_url;
  const isStatic = clip.clip_type === 'static' || !isVideo;

  useEffect(() => {
    if (isActive && isVideo && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  }, [isActive, isVideo]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {isVideo ? (
        <video
          ref={videoRef}
          src={clip.clip_url}
          className="w-full h-full object-cover"
          muted
          playsInline
          onEnded={onEnded}
          loop={false}
        />
      ) : (
        <motion.img
          src={clip.image_url}
          alt={`Slide ${index + 1}`}
          className="w-full h-full object-cover"
          initial={{ scale: 1 }}
          animate={isActive ? { scale: 1.05 } : { scale: 1 }}
          transition={{ duration: SLIDE_DURATION / 1000, ease: "linear" }}
          draggable={false}
        />
      )}

      {/* Slide counter */}
      <div className="absolute top-4 right-4">
        <div className="bg-black/40 rounded-full px-2 py-0.5 text-white text-[10px] font-medium">
          {index + 1}
        </div>
      </div>
    </div>
  );
}

export default function ReelPlayer({ clips = [], autoPlay = false }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const timerRef = useRef(null);

  const current = clips[currentIndex];
  const isVideo = current?.clip_type === 'animated' && current?.clip_url;

  const goNext = () => setCurrentIndex(i => Math.min(i + 1, clips.length - 1));
  const goPrev = () => setCurrentIndex(i => Math.max(i - 1, 0));

  useEffect(() => {
    if (!playing || isVideo) return;
    timerRef.current = setTimeout(() => {
      if (currentIndex < clips.length - 1) {
        setCurrentIndex(i => i + 1);
      } else {
        setPlaying(false);
      }
    }, SLIDE_DURATION);
    return () => clearTimeout(timerRef.current);
  }, [playing, currentIndex, isVideo, clips.length]);

  const handleVideoEnded = () => {
    if (currentIndex < clips.length - 1) {
      setCurrentIndex(i => i + 1);
    } else {
      setPlaying(false);
    }
  };

  if (!clips.length) return null;

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: "9/16", maxHeight: "65vh" }}>
      {/* Progress bar strip */}
      <div className="absolute top-2 left-3 right-3 z-20 flex gap-0.5">
        {clips.map((_, i) => (
          <div key={i} className="flex-1 h-0.5 rounded-full overflow-hidden bg-white/25">
            {i < currentIndex && <div className="h-full w-full bg-white" />}
            {i === currentIndex && playing && !isVideo && (
              <motion.div
                className="h-full bg-white"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: SLIDE_DURATION / 1000, ease: "linear" }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Slide frames */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <SlideFrame
            clip={current}
            index={currentIndex}
            isActive={playing || !autoPlay}
            onEnded={handleVideoEnded}
          />
        </motion.div>
      </AnimatePresence>

      {/* Play/Pause button */}
      <button
        onClick={() => setPlaying(p => !p)}
        className="absolute inset-0 z-10 flex items-center justify-center"
      >
        <AnimatePresence>
          {!playing && (
            <motion.div
              key="play-icon"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center"
            >
              <Play className="w-6 h-6 text-white ml-1" />
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {/* Navigation arrows */}
      {currentIndex > 0 && (
        <button
          onClick={e => { e.stopPropagation(); goPrev(); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70"
        >
          <ChevronLeft className="w-4 h-4 text-white" />
        </button>
      )}
      {currentIndex < clips.length - 1 && (
        <button
          onClick={e => { e.stopPropagation(); goNext(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70"
        >
          <ChevronRight className="w-4 h-4 text-white" />
        </button>
      )}

      {/* Type badge */}
      <div className="absolute bottom-4 left-4 z-20">
        <span className="text-[10px] text-white/70 bg-black/40 rounded px-1.5 py-0.5">
          {current?.clip_type === 'animated' ? "🎬 video" : "📸 photo"}
        </span>
      </div>
    </div>
  );
}