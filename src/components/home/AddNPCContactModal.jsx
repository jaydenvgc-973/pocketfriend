import React, { useState } from 'react';
import { X, Search, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * AddNPCContactModal
 *
 * Picks an EXISTING account NPC to show in the Home page Contacts list. It only
 * chooses among the NPCs this account already owns and that Contacts does not
 * already show — no record is created, converted, or modified.
 */
export default function AddNPCContactModal({ isOpen, candidates = [], onSelect, onClose }) {
  const [query, setQuery] = useState('');

  const visible = candidates.filter((npc) =>
    !query.trim() || (npc.name || '').toLowerCase().includes(query.trim().toLowerCase())
  );

  const handleClose = () => {
    setQuery('');
    onClose?.();
  };

  const handlePick = (npc) => {
    setQuery('');
    onSelect?.(npc);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm bg-card border border-border rounded-t-2xl sm:rounded-2xl p-4 flex flex-col max-h-[75vh]"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-foreground">Add NPC Contact</h3>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Choose an NPC from your account who isn't in Contacts yet.
            </p>

            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search NPCs"
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
              {visible.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {candidates.length === 0
                    ? 'Every NPC in your account is already in Contacts.'
                    : 'No NPC matches that name.'}
                </div>
              ) : (
                visible.map((npc) => (
                  <button
                    key={npc.id}
                    onClick={() => handlePick(npc)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-secondary transition-colors text-left"
                  >
                    {npc.avatar_url && npc.avatar_url.trim() ? (
                      <img
                        src={npc.avatar_url}
                        alt={npc.name}
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-primary">{npc.name?.[0]?.toUpperCase()}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{npc.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {npc.character_type === 'npc_world_service'
                          ? 'Service & Support'
                          : npc.character_type === 'npc_family_member'
                            ? 'Family'
                            : 'NPC'}
                      </p>
                    </div>
                    <Plus className="w-4 h-4 text-purple-400 flex-shrink-0" />
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}