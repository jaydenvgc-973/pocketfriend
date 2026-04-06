import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ChevronRight } from 'lucide-react';

export default function SuggestedDuplicatesModal({ isOpen, onClose, duplicates = [], onMergeComplete }) {
  const [merging, setMerging] = useState(null);

  const handleMerge = async (dupeGroup) => {
    if (!window.confirm(`Merge ${dupeGroup.name} into one character?`)) return;
    
    setMerging(dupeGroup.name);
    try {
      await base44.functions.invoke('mergeCharacters', {
        characterIds: dupeGroup.records.map(r => r.id),
        primaryCharacterId: dupeGroup.records[0].id,
      });
      onMergeComplete?.();
    } catch (err) {
      alert('Merge failed: ' + err.message);
    } finally {
      setMerging(null);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4 max-h-96 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h3 className="text-sm font-semibold text-foreground">Suggested Duplicates</h3>
        </div>

        {duplicates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No duplicates detected</p>
        ) : (
          <div className="space-y-2">
            {duplicates.map((dupeGroup, idx) => (
              <div key={idx} className="border border-border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground capitalize">{dupeGroup.name}</p>
                    <p className="text-xs text-muted-foreground">{dupeGroup.records.length} copies found</p>
                  </div>
                  <Button
                    onClick={() => handleMerge(dupeGroup)}
                    disabled={merging === dupeGroup.name}
                    size="sm"
                    className="rounded-lg"
                  >
                    {merging === dupeGroup.name ? 'Merging...' : 'Merge'}
                  </Button>
                </div>
                <div className="space-y-2 mt-3">
                  {dupeGroup.records.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 p-2 bg-secondary/40 rounded-lg">
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt={r.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-primary">{r.name?.[0]?.toUpperCase()}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{r.name}</p>
                        <p className="text-[10px] text-muted-foreground">Created: {new Date(r.created_date).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <Button onClick={onClose} variant="outline" size="sm" className="w-full rounded-lg">
          Done
        </Button>
      </motion.div>
    </div>,
    document.body
  );
}