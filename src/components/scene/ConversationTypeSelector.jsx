import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Users, User, UtensilsCrossed, X, ChevronRight } from "lucide-react";

const CONVERSATION_TYPES = [
  {
    id: "group",
    label: "Talk with group",
    icon: Users,
    description: "Address everyone present",
    note: "They might interrupt or respond as a group",
  },
  {
    id: "one_on_one",
    label: "Pull aside",
    icon: User,
    description: "Private conversation with one person",
    note: "Move away from the group for a private moment",
  },
  {
    id: "quick",
    icon: MessageSquare,
    label: "Quick interaction",
    description: "Brief, surface-level exchange",
    note: "5-10 seconds, then move on",
  },
  {
    id: "employee",
    label: "Order / Ask staff",
    icon: UtensilsCrossed,
    description: "Brief professional interaction",
    note: "They stay in role, keep it quick",
  },
];

export default function ConversationTypeSelector({ isOpen, onClose, onSelect, npcName, hasEmployees = false, isGroup = false }) {
  const [selectedType, setSelectedType] = useState(null);

  const availableTypes = CONVERSATION_TYPES.filter(type => {
    if (type.id === "group" && !isGroup) return false;
    if (type.id === "employee" && !hasEmployees) return false;
    return true;
  });

  const handleSelect = (typeId) => {
    setSelectedType(typeId);
    setTimeout(() => {
      onSelect(typeId);
      setSelectedType(null);
      onClose();
    }, 200);
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Talk with {npcName}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">How do you want to interact?</p>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
              {availableTypes.map(type => {
                const Icon = type.icon;
                const isSelected = selectedType === type.id;

                return (
                  <motion.button
                    key={type.id}
                    onClick={() => handleSelect(type.id)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`w-full flex items-start gap-3 px-4 py-3 rounded-2xl border transition-all text-left ${
                      isSelected
                        ? "bg-primary/10 border-primary/60"
                        : "bg-secondary border-border hover:border-primary/40"
                    }`}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{type.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{type.description}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">{type.note}</p>
                    </div>
                    {isSelected && <ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-1" />}
                  </motion.button>
                );
              })}
            </div>

            <div className="border-t border-border px-5 py-3 bg-secondary/30">
              <p className="text-[10px] text-muted-foreground/60 text-center">
                Your choice affects how they respond and what they share
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}