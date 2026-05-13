import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { X, Users, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { fetchUnifiedRoster, getInitial } from "@/lib/unifiedRosterUtils";

/**
 * GuestSelectorModal — canonical identity picker for scene guests.
 *
 * IDENTITY CONTRACT:
 * - All selectable people come from fetchUnifiedRoster (canonical Character records only).
 * - Every entry has a real canonical_person_id (Character.id — no synthetic IDs).
 * - Unresolved people (needs_review) are shown in diagnostics, not as selectable guests.
 * - onSelect receives the full roster entry so callers have canonical_person_id + avatar.
 */
export default function GuestSelectorModal({ location, onSelect, onClose }) {
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState('loading'); // 'loading'|'fresh'|'error'|'user_only'
  const [repairDiagnostics, setRepairDiagnostics] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadStatus('loading');

    base44.auth.me()
      .then(user => {
        if (!user?.email || cancelled) return;
        return fetchUnifiedRoster(base44, user.email)
          .then(({ roster: r, repairDiagnostics: diag }) => {
            if (cancelled) return;
            // Exclude the user-self entry — they are already in the scene
            const guests = r.filter(e => !e.is_user);
            if (guests.length === 0 && r.length <= 1) {
              setLoadStatus('user_only');
            } else {
              setLoadStatus('fresh');
            }
            setRoster(guests);
            // RUNTIME PROOF LOG — readable in browser console when modal opens
            console.group('[GuestSelectorModal] Canonical roster loaded');
            console.log(`Total selectable guests: ${guests.length}`);
            guests.forEach(e => console.log(
              `  SELECTABLE | canonical_person_id=${e.canonical_person_id} | name="${e.name}" | type=${e.character_type} | id_is_synthetic=${e.canonical_person_id?.startsWith('npc_') || e.canonical_person_id === '__user__'}`
            ));
            if (diag?.length > 0) {
              setRepairDiagnostics(diag);
              console.group(`[GuestSelectorModal] NOT selectable — needs_review (${diag.length})`);
              diag.forEach(d => console.warn(`  needs_review | name="${d.name}" | confidence=${d.confidence} | reason=${d.failure_reason}`));
              console.groupEnd();
            } else {
              console.log('[GuestSelectorModal] No needs_review entries.');
            }
            console.groupEnd();
          });
      })
      .catch(err => {
        console.error('[GuestSelectorModal] fetchUnifiedRoster failed:', err?.message);
        if (!cancelled) setLoadStatus('error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const handleSelect = () => {
    if (selectedGuest) {
      // Always pass canonical_person_id — never a synthetic ID
      onSelect({
        id: selectedGuest.canonical_person_id,
        canonical_person_id: selectedGuest.canonical_person_id,
        name: selectedGuest.name,
        type: 'character',
        avatar_url: selectedGuest.avatar_url,
        character: selectedGuest,
      });
    }
  };

  const handleRetry = () => {
    setRoster([]);
    setLoadStatus('loading');
    setLoading(true);
    setRepairDiagnostics([]);
    base44.auth.me()
      .then(user => {
        if (!user?.email) return;
        return fetchUnifiedRoster(base44, user.email)
          .then(({ roster: r, repairDiagnostics: diag }) => {
            setRoster(r.filter(e => !e.is_user));
            setLoadStatus('fresh');
            setRepairDiagnostics(diag || []);
          });
      })
      .catch(() => setLoadStatus('error'))
      .finally(() => setLoading(false));
  };

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 p-4">
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">Invite a Guest</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Choose from your characters
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Load states */}
          {loadStatus === 'error' && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1.5">
              <p className="font-medium">Character list failed to load.</p>
              <p className="text-destructive/70">Could not fetch your characters. This is a load failure — your account is not empty.</p>
              <button onClick={handleRetry} className="mt-1 flex items-center gap-1.5 px-3 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive font-medium transition-colors">
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          )}
          {loadStatus === 'user_only' && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400 flex items-center justify-between gap-2">
              <span>Character list may be incomplete — only your profile loaded.</span>
              <button onClick={handleRetry} className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-medium flex-shrink-0">
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          )}

          {/* Repair diagnostics — unresolved people shown transparently, not as selectable guests */}
          {repairDiagnostics.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-400 space-y-1">
              <p className="font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Some people need review before they can be selected:
              </p>
              {repairDiagnostics.map((d, i) => (
                <p key={i} className="text-amber-400/80">• <span className="font-medium">{d.name}</span> — {d.failure_reason || 'Confidence too low to auto-resolve'}</p>
              ))}
            </div>
          )}

          {/* Guest list */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
              </div>
            ) : roster.length === 0 && loadStatus !== 'error' ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                No characters available to invite
              </p>
            ) : (
              roster.map((entry) => (
                <motion.button
                  key={entry.canonical_person_id}
                  onClick={() => setSelectedGuest(entry)}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedGuest?.canonical_person_id === entry.canonical_person_id
                      ? "bg-primary/10 border-primary/40"
                      : "bg-secondary/30 border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {entry.avatar_url ? (
                      <img
                        src={entry.avatar_url}
                        alt={entry.name}
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-primary">
                          {getInitial(entry.name)}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {entry.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {entry.is_active_character && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                            Active
                          </span>
                        )}
                        {entry.character_type && !entry.is_active_character && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium capitalize">
                            {entry.character_type.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button
              onClick={onClose}
              variant="outline"
              size="sm"
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSelect}
              disabled={!selectedGuest}
              size="sm"
              className="flex-1 rounded-lg gap-2"
            >
              <Users className="w-3.5 h-3.5" />
              Invite Guest
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}