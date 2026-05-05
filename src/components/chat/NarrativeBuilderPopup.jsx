import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, Wand2, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

export default function NarrativeBuilderPopup({ isOpen, onClose, characterId, conversationId, chatHistory, onNarrativeSubmitted, currentUser }) {
  const [narrativeText, setNarrativeText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    if (!characterId || chatHistory.length < 2) return;

    setIsGenerating(true);
    try {
      const res = await base44.functions.invoke('generateNarrative', {
        characterId,
        chatHistory: chatHistory.slice(-5) // Use last 5 messages for context
      });

      if (res?.data?.success) {
        setNarrativeText(res.data.narrative);
      }
    } catch (err) {
      console.error('Failed to generate narrative:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async () => {
    if (!narrativeText.trim() || !characterId) return;

    setIsSubmitting(true);
    setError(null);
    try {
      // Resolve conversationId — may be null if no messages sent yet in this session.
      // In that case, look up the existing conversation or create one now.
      let resolvedConvoId = conversationId;
      if (!resolvedConvoId) {
        // Try to find an existing direct conversation for this character
        try {
          const existing = await base44.entities.Conversation.filter({ character_ids: [characterId] }, '-last_message_date', 1);
          resolvedConvoId = existing[0]?.id || null;
        } catch {}
        // Still nothing — create a fresh conversation
        if (!resolvedConvoId) {
          const newConvo = await base44.entities.Conversation.create({
            title: `Chat`,
            type: 'direct',
            character_ids: [characterId],
            ...(currentUser?.email ? { owner_email: currentUser.email } : {}),
          });
          resolvedConvoId = newConvo?.id || null;
        }
      }

      if (!resolvedConvoId) {
        setError('Could not create conversation. Try sending a message first.');
        return;
      }

      const res = await base44.functions.invoke('submitNarrative', {
        characterId,
        conversationId: resolvedConvoId,
        narrativeContent: narrativeText
      });

      if (res?.data?.success) {
        setNarrativeText('');
        onNarrativeSubmitted?.();
        onClose();
      } else {
        setError('Narrative submission failed. Try again.');
      }
    } catch (err) {
      console.error('Failed to submit narrative:', err);
      setError('Something went wrong. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4"
          onClick={onClose}
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
              <div>
                <h3 className="text-sm font-semibold text-foreground">Narrative Builder</h3>
                <p className="text-xs text-muted-foreground mt-1">Add world events or scene details</p>
              </div>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Textarea */}
              <textarea
                value={narrativeText}
                onChange={(e) => setNarrativeText(e.target.value)}
                placeholder="Describe what happens... (e.g., 'A sudden rainstorm hits the city' or 'Your friend calls with urgent news')"
                className="w-full h-32 p-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />

              {/* Button Group */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleGenerate}
                  disabled={isGenerating || chatHistory.length < 2}
                  className="flex-1"
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  {isGenerating ? 'Generating...' : 'Generate with AI'}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!narrativeText.trim() || isSubmitting}
                  className="flex-1"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSubmitting ? 'Submitting...' : 'Submit Narrative'}
                </Button>
              </div>

              {/* Error */}
              {error && <p className="text-xs text-destructive">{error}</p>}
              {/* Helper Text */}
              <p className="text-xs text-muted-foreground">This will become part of the story and affect how the character responds.</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}