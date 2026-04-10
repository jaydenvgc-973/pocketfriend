import { useState } from "react";
import { MoreVertical, Image, Gamepad2, Sparkles, Wrench, Globe, BookOpen, DollarSign } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const menuItems = [
  { id: "media",        icon: Image,     label: "Media Gallery" },
  { id: "game",         icon: Gamepad2,  label: "Play a Game" },
  { id: "narrative",    icon: Sparkles,  label: "Action" },
  { id: "contacts",     icon: Globe,     label: "World Contacts" },
  { id: "story",        icon: BookOpen,  label: "Add Story Event" },
  { id: "money",        icon: DollarSign,label: "Send Money" },
  { id: "troubleshoot", icon: Wrench,    label: "Troubleshoot" },
];

export default function ChatActionsMenu({ visible = {}, onSelect }) {
  const [open, setOpen] = useState(false);

  const filtered = menuItems.filter(item => visible[item.id] !== false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="More actions"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full mt-2 right-0 z-50 bg-card border border-border rounded-2xl shadow-2xl py-1.5 w-52"
            >
              {filtered.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setOpen(false); onSelect(item.id); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/70 transition-colors text-left"
                  >
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-foreground">{item.label}</span>
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}