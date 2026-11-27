import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { MapPin, Home, X } from 'lucide-react';
import { createPortal } from 'react-dom';

/**
 * InviteOutModal — a character invites the User out.
 *
 * Button arrangement (two columns, consistent sizing):
 *   Carry on without me | ✅ Let's go
 *   Maybe later         | ❌ Decline
 *
 * "Carry on without me" lets the character continue their own plan alone: they move to
 * the invited place through the established location writer when it is somewhere else,
 * and stay put when the invitation is to where they already are. The User never moves,
 * never opens a scene, and stays on the page the modal was opened from.
 */
// Every invitation button shares one footprint, so a longer label wraps inside its own
// cell instead of widening the modal or overflowing a phone.
const inviteBtnClass = "rounded-lg h-auto min-h-[40px] px-2 py-2 text-[11px] leading-tight whitespace-normal text-center disabled:opacity-50";

export default function InviteOutModal({ invitations, onAccept, onDecline, onMaybeLater, onCarryOn, onClose, busy = false }) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  
  if (!invitations || invitations.length === 0) return null;
  const selectedInv = invitations[selectedIdx];

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md bg-card border border-border rounded-2xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold text-foreground">You're invited!</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {invitations.length} {invitations.length === 1 ? 'character' : 'characters'} want to hang out
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {invitations.map((inv, idx) => (
            <motion.button
              key={`${inv.characterId}-${idx}`}
              onClick={() => setSelectedIdx(idx)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={`w-full text-left rounded-xl p-3 border transition-all ${
                selectedIdx === idx
                  ? "bg-primary/10 border-primary/40"
                  : "bg-secondary/50 border-border/50 hover:border-primary/30"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {inv.characterAvatar ? (
                    <img src={inv.characterAvatar} alt={inv.characterName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-primary-foreground">{inv.characterName?.[0]}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{inv.characterName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {inv.inviteType === 'home' ? (
                      <>
                        <Home className="w-3 h-3 text-blue-400" />
                        <span className="text-xs text-muted-foreground">wants you over</span>
                      </>
                    ) : (
                      <>
                        <MapPin className="w-3 h-3 text-amber-400" />
                        <span className="text-xs text-muted-foreground">wants to go out</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-primary mt-1 font-medium">📍 {inv.locationName}</p>
                </div>
              </div>
            </motion.button>
          ))}
        </div>

        {/* Two equal columns. Every button shares the same footprint so the longer
            "Carry on without me" label wraps inside its own cell instead of widening
            the modal or overflowing a phone. */}
        <div className="grid grid-cols-2 gap-2">
          {/* Row 1: Carry on without me | ✅ Let's go
              Row 2: Maybe later         | ❌ Decline
              A screen that offers only the two original options (a scene) keeps its own
              unchanged pair — Decline | Let's go — because it never passes onCarryOn. */}
          {!onCarryOn && (
            <Button onClick={() => onDecline(selectedInv)} variant="outline" size="sm" disabled={busy} className={inviteBtnClass}>
              ❌ Decline
            </Button>
          )}
          {onCarryOn && (
            <Button onClick={() => onCarryOn(selectedInv)} variant="outline" size="sm" disabled={busy} className={inviteBtnClass}>
              Carry on without me
            </Button>
          )}
          <Button onClick={() => onAccept(selectedInv)} size="sm" disabled={busy} className={inviteBtnClass}>
            ✅ Let's go
          </Button>
          {onCarryOn && onMaybeLater && (
            <Button onClick={() => onMaybeLater(selectedInv)} variant="outline" size="sm" disabled={busy} className={inviteBtnClass}>
              Maybe later
            </Button>
          )}
          {onCarryOn && (
            <Button onClick={() => onDecline(selectedInv)} variant="outline" size="sm" disabled={busy} className={inviteBtnClass}>
              ❌ Decline
            </Button>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}