import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, Play, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

export default function CharacterInteractionSimulator({ characters }) {
  const [selected, setSelected] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const activeCharacters = characters.filter(c => c.status !== 'deleted');

  const toggleSelect = (id) => {
    if (selected.includes(id)) {
      setSelected(selected.filter(s => s !== id));
    } else if (selected.length < 4) {
      setSelected([...selected, id]);
    }
  };

  const handleSimulate = async () => {
    if (selected.length < 2) return;

    setIsRunning(true);
    try {
      const res = await base44.functions.invoke('simulateCharacterInteraction', {
        character_ids: selected
      });

      if (res?.data?.success) {
        setResult(res.data.interaction);
        setShowModal(true);
      }
    } catch (err) {
      alert('Failed to simulate interaction. Try again.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <>
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Simulate Interaction</p>
        </div>

        <p className="text-xs text-muted-foreground">Select 2-4 characters to simulate a dynamic interaction.</p>

        {/* Character selection grid */}
        <div className="grid grid-cols-2 gap-2">
          {activeCharacters.map(char => (
            <button
              key={char.id}
              onClick={() => toggleSelect(char.id)}
              className={`p-2 rounded-xl border transition-colors text-left text-xs ${
                selected.includes(char.id)
                  ? 'bg-primary/10 border-primary'
                  : 'bg-secondary border-border hover:border-primary/40'
              }`}
            >
              <div className="font-medium text-foreground truncate">{char.name}</div>
              <div className="text-muted-foreground text-[10px] truncate">{char.archetype || 'character'}</div>
            </button>
          ))}
        </div>

        {selected.length > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20">
            <span className="text-xs text-primary font-medium">{selected.length} selected</span>
          </div>
        )}

        <Button
          onClick={handleSimulate}
          disabled={selected.length < 2 || isRunning}
          className="w-full h-10 rounded-xl"
        >
          <Play className="w-4 h-4 mr-2" />
          {isRunning ? 'Simulating...' : 'Simulate Interaction'}
        </Button>
      </div>

      {/* Result modal */}
      {createPortal(
        <AnimatePresence>
          {showModal && result && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4"
              onClick={() => setShowModal(false)}
            >
              <motion.div
                initial={{ y: 80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 80, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl bg-card border border-border rounded-t-2xl max-h-[80vh] overflow-y-auto"
              >
                {/* Header */}
                <div className="sticky top-0 bg-card/80 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    {result.characters.join(' & ')}
                  </h3>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Scene summary */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Scene</p>
                    <p className="text-sm text-foreground leading-relaxed">{result.scene_summary}</p>
                  </div>

                  {/* Dialogue */}
                  {result.dialogue && result.dialogue.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Dialogue</p>
                      <div className="space-y-2 bg-secondary/50 rounded-xl p-3">
                        {result.dialogue.map((line, idx) => (
                          <div key={idx} className="text-xs">
                            <span className="font-medium text-primary">{line.speaker}:</span>
                            <span className="text-foreground ml-2">"{line.text}"</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Outcome */}
                  {result.outcome && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">What Happened</p>
                      <p className="text-sm text-foreground leading-relaxed">{result.outcome}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}