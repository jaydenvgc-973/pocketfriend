import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building, ChevronDown } from "lucide-react";
import { getUnitLabel } from "@/lib/residentialUnits";

/**
 * ApartmentSwitcher
 *
 * Chooses which apartment of a multi-dwelling property is being visited. Separate from
 * the zone dropdown: the unit is the household, the zone is the room inside it. Zones and
 * their images stay shared across units.
 *
 * The menu is rendered in a portal so it can never be clipped by the row it sits in —
 * on Scenes that row scrolls horizontally, and a clipped menu is what let the
 * conversation appear over the apartment options. It shows four units at a time and
 * scrolls for the rest, opening upward where the caller asks for it.
 */

const ROW_HEIGHT = 32; // one option row
const VISIBLE_ROWS = 4;
const MENU_WIDTH = 192; // w-48
const MENU_CHROME = 44; // header + padding

export default function ApartmentSwitcher({
  units = [],
  activeUnitId = null,
  onSelect = () => {},
  location = null,
  allowNone = false,
  noneLabel = "Whole building",
  className = "",
  direction = "down",
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  // Close on outside click — the menu is portaled, so both nodes count as inside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const close = () => setOpen(false);
    // Scrolling the page (or the row the button sits in) closes the menu; scrolling
    // inside the menu itself must not.
    const onScroll = (e) => {
      const target = e.target;
      if (menuRef.current && target instanceof Node && menuRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Anchor the portal to the button, honouring the requested opening direction and
  // keeping four options visible inside whatever room the viewport actually has.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const spaceAbove = r.top - 8;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    let up = direction === "up";
    if (up && spaceAbove < 96) up = false;
    else if (!up && spaceBelow < 96) up = true;
    const available = up ? spaceAbove : spaceBelow;
    // Four apartments stay visible; the optional "whole building" row sits on top of them.
    const rows = VISIBLE_ROWS + (allowNone ? 1 : 0);
    const listMax = Math.max(ROW_HEIGHT, Math.min(rows * ROW_HEIGHT, available - MENU_CHROME));
    const width = Math.min(window.innerWidth - 16, Math.max(MENU_WIDTH, r.width));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(up
      ? { left, width, bottom: window.innerHeight - r.top + 6, listMax }
      : { left, width, top: r.bottom + 6, listMax });
  }, [open, direction, allowNone]);

  if (units.length === 0) return null;

  const active = units.find((u) => u.unit_id === activeUnitId) || null;
  const buttonLabel = active ? getUnitLabel(active.unit_name, location) : noneLabel;

  const choose = (unitId) => {
    setOpen(false);
    onSelect(unitId);
  };

  const optionClass = (isActive) =>
    `w-full h-8 flex items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-secondary ${
      isActive ? "bg-primary/10 text-primary" : "text-foreground"
    }`;

  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`max-w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
          active
            ? "bg-primary/10 border-primary/40 text-primary"
            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
        }`}
        title="Apartment"
      >
        <Building className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate max-w-[110px]">{buttonLabel}</span>
        <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
          className="fixed z-[80] bg-card border border-border rounded-xl shadow-xl overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Apartment</p>
          </div>
          <div className="overflow-y-auto py-1" style={{ maxHeight: pos.listMax }}>
            {allowNone && (
              <button onClick={() => choose(null)} className={optionClass(!active)}>
                <span className="flex-1 truncate">{noneLabel}</span>
                {!active && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
              </button>
            )}
            {units.map((unit) => {
              const isActive = unit.unit_id === activeUnitId;
              return (
                <button key={unit.unit_id} onClick={() => choose(unit.unit_id)} className={optionClass(isActive)}>
                  <span className="flex-1 truncate">{getUnitLabel(unit.unit_name, location)}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}