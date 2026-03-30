import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";

// Cache generated backgrounds across sessions (in-memory, per game type)
const bgCache = {};

const PROMPTS = {
  tictactoe: "wrinkled notebook paper texture with a hand-drawn pencil grid, vintage paper game board, cozy lo-fi aesthetic, soft warm tones",
  pool: "top-down realistic pool table with vibrant green felt, dark mahogany wooden rail, overhead billiard hall lighting, photorealistic",
  dotsandboxes: "colorful cartoon game board with bright pastel panels, playful neon dots grid, fun pop art style, clean vector illustration",
  gemduel: "magical glowing gem puzzle game background, vibrant jewels sparkling in dark space, cosmic purple and gold atmosphere, fantasy game UI",
};

export function useGameBackground(gameType) {
  const [bgUrl, setBgUrl] = useState(bgCache[gameType] || null);
  const [loading, setLoading] = useState(!bgCache[gameType]);

  useEffect(() => {
    if (bgCache[gameType]) {
      setBgUrl(bgCache[gameType]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    base44.integrations.Core.GenerateImage({ prompt: PROMPTS[gameType] || PROMPTS.tictactoe })
      .then(res => {
        if (cancelled) return;
        const url = res?.url;
        if (url) {
          bgCache[gameType] = url;
          setBgUrl(url);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [gameType]);

  return { bgUrl, loading };
}