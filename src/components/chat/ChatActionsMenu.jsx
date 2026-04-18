import { useState } from "react";
import { MoreVertical, Image, Gamepad2, Sparkles, Wrench, Globe, BookOpen, DollarSign, Grid3x3, ShoppingBag, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const topLevelItems = [
  { id: "narrative",    icon: Sparkles,  label: "Action" },
  { id: "story",        icon: BookOpen,  label: "Add Story Event" },
  { id: "game",         icon: Gamepad2,  label: "Play a Game" },
  { id: "apps",         icon: Grid3x3,   label: "Apps" },
  { id: "troubleshoot", icon: Wrench,    label: "Troubleshoot" },
];

const appsDrawerItems = [
  { id: "media",     icon: Image,       label: "Media Gallery" },
  { id: "money",     icon: DollarSign,  label: "Send Money" },
  { id: "contacts",  icon: Globe,       label: "World Contacts" },
  { id: "shopping",  icon: ShoppingBag, label: "Shopping" },
];

export default function ChatActionsMenu({ visible = {}, onSelect }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);

  const filtered = topLevelItems.filter(item => {
    if (item.id === "apps") return true; // Always show apps
    return visible[item.id] !== false;
  });

  const filteredApps = appsDrawerItems.filter(item => visible[item.id] !== false);

  const handleTopLevelSelect = (itemId) => {
    if (itemId === "apps") {
      setDropdownOpen(false);
      setAppsOpen(true);
      return;
    }
    setDropdownOpen(false);
    onSelect(itemId);
  };

  const handleAppsSelect = (itemId) => {
    setAppsOpen(false);
    onSelect(itemId);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen(prev => !prev)}
        className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="More actions"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {/* Top-level dropdown */}
      <AnimatePresence>
        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
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
                    onClick={() => handleTopLevelSelect(item.id)}
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

      {/* Apps drawer modal */}
      <AnimatePresence>
        {appsOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setAppsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center"
            >
              <div className="w-72 bg-card border border-border rounded-3xl shadow-2xl p-5"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-semibold text-foreground">Apps</h2>
                <button
                  onClick={() => setAppsOpen(false)}
                  className="p-1 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {filteredApps.map(item => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleAppsSelect(item.id)}
                      className="aspect-square flex flex-col items-center justify-center gap-2 rounded-2xl bg-secondary hover:bg-secondary/80 transition-colors"
                    >
                      <Icon className="w-6 h-6 text-primary" />
                      <span className="text-xs font-medium text-foreground text-center px-1">{item.label}</span>
                    </button>
                  );
                })}
              </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}