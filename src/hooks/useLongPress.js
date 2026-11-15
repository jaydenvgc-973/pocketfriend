import { useCallback, useEffect, useRef } from "react";

/**
 * Press-and-hold detection for a single element.
 *
 * Returns pointer handlers to spread onto that element. The press fires once, after
 * `delay`, and only while the pointer stays within `moveTolerance` of where it went
 * down — so an ordinary scroll cancels it, and the browser's own pointercancel (which
 * it sends as soon as a touch becomes a scroll) cancels it too. The click that follows
 * a press that has already fired is swallowed, so the element's normal tap keeps its
 * own behavior.
 */
export default function useLongPress(
  onLongPress,
  { delay = 550, moveTolerance = 10, suppressContextMenu = true } = {}
) {
  const timer = useRef(null);
  const origin = useRef(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback((event) => {
    if (event.button != null && event.button !== 0) return;
    fired.current = false;
    origin.current = { x: event.clientX, y: event.clientY };
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      onLongPress();
    }, delay);
  }, [clear, delay, onLongPress]);

  const onPointerMove = useCallback((event) => {
    if (!timer.current || !origin.current) return;
    const dx = event.clientX - origin.current.x;
    const dy = event.clientY - origin.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > moveTolerance) clear();
  }, [clear, moveTolerance]);

  const end = useCallback(() => {
    origin.current = null;
    clear();
  }, [clear]);

  const onClick = useCallback((event) => {
    if (!fired.current) return;
    fired.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onContextMenu = useCallback((event) => {
    event.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerLeave: end,
    onPointerCancel: end,
    onClick,
    // Prose keeps the browser's own menu and text selection; only an undisclosed
    // title uses the press with the menu suppressed.
    onContextMenu: suppressContextMenu ? onContextMenu : undefined,
  };
}