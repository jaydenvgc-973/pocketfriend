import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import CharacterAvatar from '@/components/chat/CharacterAvatar';

export default function CharacterSelector({ characters, onConfirm, onCancel }) {
  const [selected, setSelected] = useState([]);
  const [groupTitle, setGroupTitle] = useState('');

  const toggleCharacter = (id) => {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(cid => cid !== id)
        : [...prev, id]
    );
  };

  const handleConfirm = () => {
    if (selected.length > 0) {
      onConfirm(selected, groupTitle.trim());
    }
  };

  const alpha = (a, b) => (a.name || '').localeCompare(b.name || '');
  const activeCreated = characters.filter(c => c.character_type === 'active_created_character').sort(alpha);
  const npcFictitious = characters.filter(c => c.character_type === 'npc_fictitious').sort(alpha);

  const renderGroup = (label, group) => {
    if (group.length === 0) return null;
    return (
      <div key={label}>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1 mt-3 first:mt-0">{label}</p>
        <div className="space-y-2">
          {group.map(char => (
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
          ))}
        </div>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-x-0 bottom-[60px] z-40 border-t border-border bg-card/95 backdrop-blur-sm shadow-lg"
      style={{ maxHeight: '70vh' }}
    >
      <div className="max-w-lg mx-auto h-full flex flex-col px-4 py-3" style={{ maxHeight: '70vh' }}>
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <h2 className="text-sm font-semibold">Select characters</h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-3 flex-shrink-0">
          <Input
            placeholder="Group chat title (optional)"
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
            className="w-full text-sm"
          />
        </div>

        <div className="overflow-y-auto flex-1 mb-3 pr-0.5">
          {characters.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No active characters available</p>
            </div>
          ) : (
            <>
              {renderGroup('Active Characters', activeCreated)}
              {renderGroup('NPC Fictitious', npcFictitious)}
            </>
          )}
        </div>

        <div className="flex gap-2 flex-shrink-0">
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