import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Home, ChevronDown, Navigation, DoorOpen, UserX, Users, LogIn, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";

const OPTIONS_VISITOR = [
  { id: "tour",    label: "Take a Tour", icon: Navigation, color: "text-blue-400",    desc: "Get a guided walkthrough with a realtor" },
  { id: "move_in", label: "Move In",     icon: LogIn,      color: "text-emerald-400", desc: "Make this your residence" },
];

const OPTIONS_RESIDENT = [
  { id: "tour",               label: "Take a Tour",           icon: Navigation, color: "text-blue-400",    desc: "Get a guided walkthrough" },
  { id: "move_out",           label: "Move Out",              icon: LogOut,     color: "text-rose-400",    desc: "Leave this residence" },
  { id: "ask_locals_leave",   label: "Ask Locals to Leave",   icon: Users,      color: "text-amber-400",   desc: "Request non-resident locals to leave" },
  { id: "ask_visitors_leave", label: "Ask Visitors to Leave", icon: DoorOpen,   color: "text-orange-400",  desc: "Ask temporary guests to leave" },
  { id: "kick_out",           label: "Kick Out",              icon: UserX,      color: "text-destructive", desc: "Remove someone forcefully" },
];

export default function ResidenceOptionsDropdown({
  location,
  character,
  sceneCharacters = [],
  isResident = false,
  currentUser,
  onTour,
  onMoveIn,
  onMoveOut,
  onKickOut,
  onAskToLeave,
}) {
  const [open, setOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultMsg, setResultMsg] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOption = async (optionId) => {
    setOpen(false);
    setResultMsg(null);

    if (optionId === "tour") {
      onTour?.();
      return;
    }
    if (optionId === "move_in") {
      onMoveIn?.();
      return;
    }
    if (optionId === "move_out") {
      onMoveOut?.();
      return;
    }
    if (optionId === "kick_out") {
      onKickOut?.();
      return;
    }
    if (optionId === "ask_locals_leave" || optionId === "ask_visitors_leave") {
      setIsProcessing(true);
      const targetType = optionId === "ask_locals_leave" ? "locals" : "visitors";
      try {
        const result = await base44.integrations.Core.InvokeLLM({
          prompt: `You are at ${location?.name}. The user asks ${targetType} to leave.
Characters present: ${sceneCharacters.map(c => c.name).join(", ") || "no one"}.
Write one short narrative sentence (1 sentence) describing what happens. Keep it realistic.`,
        });
        setResultMsg(result?.trim() || `You ask the ${targetType} to leave.`);
        onAskToLeave?.(targetType, result?.trim());
      } catch {
        setResultMsg(`You ask the ${targetType} to leave.`);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
          open
            ? "bg-primary/10 border-primary/40 text-primary"
            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
        }`}
        title="Residence Options"
      >
        <Home className="w-3.5 h-3.5" />
        <span>Residence</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1.5 w-56 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-border">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Residence Options</p>
            </div>
            <div className="py-1">
              {(isResident ? OPTIONS_RESIDENT : OPTIONS_VISITOR).map(opt => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleOption(opt.id)}
                    disabled={isProcessing}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-secondary cursor-pointer"
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${opt.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{opt.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result message toast */}
      <AnimatePresence>
        {resultMsg && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute right-0 top-full mt-1.5 w-64 bg-card border border-border rounded-xl shadow-xl z-50 p-3"
          >
            <p className="text-xs text-foreground italic">{resultMsg}</p>
            <button
              onClick={() => setResultMsg(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground mt-1.5 transition-colors"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}