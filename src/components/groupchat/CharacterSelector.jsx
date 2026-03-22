import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import CharacterAvatar from '@/components/chat/CharacterAvatar';

export default function CharacterSelector({ characters, onConfirm, onCancel }) {
  const [selected, setSelected] = useState([]);

  const toggleCharacter = (id) => {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(cid => cid !== id)
        : [...prev, id]
    );
  };

  const handleConfirm = () => {
    if (selected.length > 0) {
      onConfirm(selected);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-card border border-border rounded-xl p-4 w-full max-w-lg mx-4 z-50"
    >
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Select characters</h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
          {characters.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No active characters available</p>
            </div>
          ) : (
            characters.map(char => (
              <button
                key={char.id}
                onClick={() => toggleCharacter(char.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                  selected.includes(char.id)
                    ? 'bg-primary/10 border-primary/40'
                    : 'bg-background border-border hover:border-primary/30'
                }`}
              >
                <CharacterAvatar character={char} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{char.personality_summary?.split('.')[0]}</p>
                </div>
                {selected.includes(char.id) && (
                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} size="sm" className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={selected.length === 0} size="sm" className="flex-1">
            Create ({selected.length})
          </Button>
        </div>
      </div>
    </motion.div>
  );
}