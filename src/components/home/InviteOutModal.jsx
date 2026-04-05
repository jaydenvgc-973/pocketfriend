import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { MapPin, Home, X } from 'lucide-react';
import { createPortal } from 'react-dom';

export default function InviteOutModal({ invitations, onAccept, onDecline, onClose }) {
  if (!invitations || invitations.length === 0) return null;

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

        <div className="space-y-2 max-h-56 overflow-y-auto">
          {invitations.map((inv, idx) => (
            <motion.div
              key={`${inv.characterId}-${idx}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-secondary/50 border border-border/50 rounded-xl p-3 space-y-2"
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
                        <span className="text-xs text-muted-foreground">wants you over to their place</span>
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
            </motion.div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => onDecline()}
            variant="outline"
            size="sm"
            className="flex-1 rounded-lg"
          >
            Not now
          </Button>
          <Button
            onClick={() => onAccept(invitations[0])}
            size="sm"
            className="flex-1 rounded-lg gap-2"
          >
            Let's go
          </Button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}