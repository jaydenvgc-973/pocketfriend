import { useEffect, useState } from "react";

/**
 * The visible height of the screen while the on-screen keyboard is open.
 *
 * Scenes is one screen tall and must stay inside the area the user can actually see. When
 * the keyboard opens, the visible area is smaller than the window and this returns that
 * smaller height, so the message field sits above the keyboard. When the keyboard closes it
 * returns null and Scenes uses its normal full height again — so browser chrome sliding
 * away while scrolling never makes the layout jump.
 */
export function useSceneViewportHeight() {
  const [height, setHeight] = useState(null);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      const visible = Math.round(vv.height);
      const full = Math.round(window.innerHeight);
      setHeight(visible < full - 80 ? visible : null);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return height;
}