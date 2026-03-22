import { motion } from "framer-motion";

export default function TypingIndicator({ name }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="flex items-center gap-3 px-4 py-2"
    >
      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
        <span className="text-xs font-medium text-primary">{name?.[0]?.toUpperCase()}</span>
      </div>
      <div className="bg-secondary rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot-1" />
        <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot-2" />
        <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot-3" />
      </div>
    </motion.div>
  );
}