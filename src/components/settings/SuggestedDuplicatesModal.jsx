import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import MergeReviewModal from './MergeReviewModal';

/**
 * SuggestedDuplicatesModal
 *
 * Lists detected duplicate groups. Clicking "Review & Merge" opens the full
 * MergeReviewModal which shows the pre-merge comparison before anything is written.
 * No auto-merge. No auto-delete.
 */
export default function SuggestedDuplicatesModal({ isOpen, onClose, duplicates = [], ownerEmail, onMergeComplete }) {
  const [activeGroup, setActiveGroup] = useState(null);

  const handleMergeComplete = () => {
    setActiveGroup(null);
    onMergeComplete?.();
  };

  if (!isOpen) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">Suggested Duplicates</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            These character names appear more than once. Click "Review &amp; Merge" to compare both records before merging. No data will be lost.
          </p>

          {duplicates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No duplicates detected</p>
          ) : (
            <div className="space-y-3">
              {duplicates.map((dupeGroup, idx) => (
                <div key={idx} className="border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground capitalize">{dupeGroup.name}</p>
                      <p className="text-xs text-muted-foreground">{dupeGroup.records.length} records found</p>
                    </div>
                    <Button
                      onClick={() => setActiveGroup(dupeGroup)}
                      size="sm"
                      variant="outline"
                      className="rounded-lg border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                    >
                      Review &amp; Merge
                    </Button>
                  </div>

                  {/* Record summary cards */}
                  <div className="space-y-2">
                    {dupeGroup.records.map((r) => {
                      const missingOwner = !r.owner_email;
                      const missingType = !r.character_type;
                      const needsRepair = missingOwner || missingType;
                      return (
                        <div key={r.id} className={`flex items-center gap-3 p-2 rounded-lg ${needsRepair ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-secondary/40'}`}>
                          {r.avatar_url ? (
                            <img src={r.avatar_url} alt={r.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-semibold text-primary">{r.name?.[0]?.toUpperCase()}</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{r.name}</p>
                            <p className="text-[10px] font-mono text-muted-foreground">{r.id?.substring(0, 12)}…</p>
                            {needsRepair ? (
                              <p className="text-[10px] text-amber-400 font-medium mt-0.5">
                                {missingOwner ? '⚠ Missing owner_email — legacy record needs repair' : '⚠ Missing character_type — needs review'}
                              </p>
                            ) : (
                              <p className="text-[10px] text-muted-foreground">{r.character_type}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button onClick={onClose} variant="outline" size="sm" className="w-full rounded-lg">
            Done
          </Button>
        </motion.div>
      </div>

      {/* Full pre-merge review opens on top */}
      {activeGroup && (
        <MergeReviewModal
          isOpen={!!activeGroup}
          onClose={() => setActiveGroup(null)}
          dupeGroup={activeGroup}
          ownerEmail={ownerEmail}
          onMergeComplete={handleMergeComplete}
        />
      )}
    </>,
    document.body
  );
}