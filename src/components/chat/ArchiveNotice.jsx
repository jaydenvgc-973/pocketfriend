import { Archive, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

export default function ArchiveNotice({ conversationId, characterName }) {
  const handleOpenArchive = () => {
    alert(`Archived messages for this conversation are safely stored. To access older messages or manage storage, visit Settings > Storage & Backup to set up optional cloud storage.`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-4 px-3 py-2.5 bg-secondary/50 border border-border rounded-xl flex items-center justify-between gap-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Archive className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground truncate">
          Older messages are archived & preserved
        </span>
      </div>
      <button
        onClick={handleOpenArchive}
        className="flex-shrink-0 text-primary hover:text-primary/80 transition-colors"
        title="Learn about archived messages"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </motion.div>
  );
}