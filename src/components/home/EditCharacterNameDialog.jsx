import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function EditCharacterNameDialog({ character, onClose }) {
  const [newName, setNewName] = useState(character.name);
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleSave = async () => {
    if (!newName.trim()) return;
    setIsLoading(true);
    await base44.entities.Character.update(character.id, { name: newName.trim() });
    queryClient.invalidateQueries({ queryKey: ["characters"] });
    setIsLoading(false);
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full mx-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Edit name</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>

          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Enter new name"
            className="h-11 rounded-xl text-base mb-4"
            autoFocus
          />

          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} disabled={isLoading} className="flex-1 rounded-xl">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isLoading || !newName.trim()} className="flex-1 rounded-xl">
              {isLoading ? "Saving..." : "Save"}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}