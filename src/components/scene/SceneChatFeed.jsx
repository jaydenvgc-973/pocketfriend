import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import SceneProductCard from "@/components/scene/SceneProductCard";
import { getPresenceAtLocation } from "@/lib/travelPresenceResolver";

/**
 * SceneChatFeed — the scene's transcript and its "who is here" line.
 *
 * Purely presentational: the same bubbles, the same activity/narrative/stage lines and the
 * same product card Scene always showed. Nothing about an activity's behaviour lives here.
 */
export default function SceneChatFeed({
  messages,
  observeMode,
  observeCast,
  activeWorkspace,
  location,
  activeZone,
  traveledWithChars,
  isWorkspaceScene,
  homeResidentsPresent,
  familyMemberNpcsPresent,
  homeResidentsAway,
  familyMemberNpcsAway,
  workerCharacters,
  unifiedPresenceEntities,
  characterIds,
  isTyping,
  isObservingTurn,
  settings,
  currentUser,
  queryClient,
  base44,
  setPendingPurchase,
  setMessages,
  onTryOn,
  bottomRef,
}) {
  return (
    // min-h-0 lets the transcript take the height that is left instead of forcing the page
    // taller: this is the one area that scrolls, and the controls around it stay on screen.
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-4 py-2 sm:py-3 space-y-3">
      <div className="text-center space-y-2">
        <span className="text-xs text-muted-foreground bg-secondary px-3 py-1 rounded-full">
          {observeMode
            ? `Watching ${observeCast.map((c) => c.name).join(", ") || "them"} at ${activeWorkspace ? `${activeWorkspace.name} · ${location.name}` : location.name}${activeZone ? ` · ${activeZone}` : ""} — you are not here`
            : `You're at ${activeWorkspace ? `${activeWorkspace.name} · ${location.name}` : location.name}${activeZone ? ` · ${activeZone}` : ""}${traveledWithChars.length > 0 ? ` with ${traveledWithChars.map((c) => c.name).join(", ")}` : ""}`}
        </span>
        {!isWorkspaceScene && (homeResidentsPresent.length > 0 || familyMemberNpcsPresent.length > 0) && <div><span className="text-xs text-green-400/80 bg-secondary/50 px-3 py-1 rounded-full">{[...homeResidentsPresent, ...familyMemberNpcsPresent].map((c) => c.name).join(", ")} {homeResidentsPresent.length + familyMemberNpcsPresent.length === 1 ? "is" : "are"} home</span></div>}
        {(homeResidentsAway.length > 0 || familyMemberNpcsAway.length > 0) && <div><span className="text-xs text-muted-foreground/60 bg-secondary/50 px-3 py-1 rounded-full">{homeResidentsAway.map((c) => c.name).concat(familyMemberNpcsAway.map((fm) => fm.name)).join(", ")} {homeResidentsAway.length + familyMemberNpcsAway.length === 1 ? "is" : "are"} away</span></div>}
        {workerCharacters.length > 0 && <div><span className="text-xs text-muted-foreground/70 bg-secondary/50 px-3 py-1 rounded-full">{workerCharacters.map((c) => c.name).join(", ")} {workerCharacters.length === 1 ? "is" : "are"} here working</span></div>}
        {!observeMode && (() => { const presentHere = getPresenceAtLocation(location, unifiedPresenceEntities).filter((e) => !characterIds.includes(e.id)); return presentHere.length > 0 ? <div><span className="text-xs text-blue-400/70 bg-secondary/50 px-3 py-1 rounded-full">{presentHere.map((e) => e.display_name).join(", ")} {presentHere.length === 1 ? "is" : "are"} also here — tap "Who's here" to interact</span></div> : null; })()}
      </div>

      <AnimatePresence>
        {messages.map((msg) => (
          <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-2 ${msg.sender === "user" ? "justify-end" : msg.sender === "narrative" || msg.sender === "stage" || msg.sender === "activity" ? "justify-center" : msg.sender === "product" ? "justify-center" : "justify-start"}`}>
            {msg.sender === "activity" ? <span className={`text-[11px] italic px-3 py-1.5 rounded-full max-w-xs text-center border ${msg.is_canon_event ? "text-foreground/80 bg-secondary/60 border-border" : "text-primary/80 bg-primary/5 border-primary/20"}`}><span className="not-italic mr-1">{msg.is_canon_event ? "✓" : "→"}</span>{msg.emoji ? `${msg.emoji} ` : ""}{msg.content}</span> : msg.sender === "narrative" ? <span className="text-xs text-muted-foreground italic bg-secondary/50 px-3 py-1.5 rounded-full max-w-xs text-center">{msg.is_canon_event ? `Already happened: ${msg.content}` : msg.content}</span> : msg.sender === "stage" ? <span className="text-[11px] text-primary/70 italic bg-primary/5 border border-primary/20 px-3 py-1.5 rounded-full max-w-xs text-center">Direction: {msg.content}</span> : msg.sender === "product" ? <SceneProductCard msg={msg} settings={settings} location={location} currentUser={currentUser} queryClient={queryClient} base44={base44} setPendingPurchase={setPendingPurchase} setMessages={setMessages} onTryOn={onTryOn} /> : msg.sender === "character" ? <React.Fragment><div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden mt-0.5">{msg.avatarUrl ? <img src={msg.avatarUrl} alt={msg.senderName} className="w-full h-full object-cover" /> : <span className="text-xs font-bold text-foreground">{msg.senderName?.[0]}</span>}</div><div className="max-w-[75%]"><p className="text-[10px] text-muted-foreground mb-0.5">{msg.senderName}</p><div className="bg-card border border-border rounded-2xl rounded-tl-sm px-3 py-2"><p className="text-sm text-foreground">{msg.content}</p></div></div></React.Fragment> : <div className="bg-primary rounded-2xl rounded-tr-sm px-3 py-2 max-w-[75%]"><p className="text-sm text-primary-foreground">{msg.content}</p></div>}
          </motion.div>
        ))}
      </AnimatePresence>

      {(isTyping || (observeMode && isObservingTurn)) && <div className="flex gap-2"><div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center"><span className="text-xs">...</span></div><div className="bg-card border border-border rounded-2xl px-3 py-2"><div className="flex gap-1"><div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-1" /><div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-2" /><div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-3" /></div></div></div>}
      <div ref={bottomRef} />
    </div>
  );
}