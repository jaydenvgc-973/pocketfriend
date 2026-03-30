import { useState } from "react";
import { Archive, ChevronDown, ChevronUp, Brain, CheckCircle2, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";

export default function ArchiveNotice({ conversationId, characterId, characterName }) {
  const [expanded, setExpanded] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [result, setResult] = useState(null); // { count, message }

  const handleRetrieve = async () => {
    if (!conversationId || !characterId) return;
    setRetrieving(true);
    setResult(null);

    try {
      // Fetch archived messages for this conversation
      const archived = await base44.entities.Message.filter(
        { conversation_id: conversationId },
        "-created_date",
        500
      );

      // Only those with archived_date set (hidden from feed but stored)
      const archivedMsgs = archived.filter(m => m.archived_date);

      if (archivedMsgs.length === 0) {
        setResult({ count: 0, message: "No archived messages found — all memories are already active." });
        return;
      }

      // Unarchive them all (restore to visible feed)
      let restored = 0;
      for (const msg of archivedMsgs) {
        await base44.entities.Message.update(msg.id, { archived_date: null });
        restored++;
      }

      // Also trigger memory extraction so character can use them in conversation
      base44.functions.invoke('extractMemoriesFromArchive', {
        conversationId,
        characterId,
      }).catch(() => {});

      setResult({ count: restored, message: `${restored} archived message${restored !== 1 ? "s" : ""} restored — ${characterName} can now remember them.` });
    } catch (err) {
      setResult({ count: -1, message: `Retrieval failed: ${err.message}` });
    } finally {
      setRetrieving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-3"
    >
      <div className="bg-secondary/50 border border-border rounded-xl overflow-hidden">
        {/* Header row */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Archive className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate">
              Older messages archived & preserved
            </span>
          </div>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
        </button>

        {/* Expanded panel */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden border-t border-border"
            >
              <div className="px-3 py-3 space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Archived messages are safely stored and linked to <strong className="text-foreground">{characterName}</strong>. Retrieving them restores them to the conversation and re-activates them as live character memory.
                </p>

                {/* Result feedback */}
                {result && (
                  <div className={`rounded-lg px-3 py-2 text-xs flex items-start gap-2 ${result.count >= 0 ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {result.message}
                  </div>
                )}

                {/* Retrieve button */}
                {!result && (
                  <button
                    onClick={handleRetrieve}
                    disabled={retrieving}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {retrieving
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Retrieving…</>
                      : <><Brain className="w-3.5 h-3.5" /> Retrieve Archived Memories</>}
                  </button>
                )}

                {result && result.count >= 0 && (
                  <button
                    onClick={() => { setResult(null); setExpanded(false); }}
                    className="w-full py-2 rounded-xl bg-secondary text-muted-foreground text-xs hover:text-foreground transition-colors"
                  >
                    Done
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}