import { useState } from "react";
import { createPortal } from "react-dom";
import { Images, X, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import RegenerateImageModal from "@/components/chat/RegenerateImageModal";

export default function MediaGallery({ messages, onDeleteImage, character, conversationId, onImageGenerated }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [regenTarget, setRegenTarget] = useState(null); // { id, url } of image to regenerate
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Prompt generator state
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  const images = messages
    .filter(msg => msg.image_url)
    .map(msg => ({
      id: msg.id,
      url: msg.image_url,
      senderType: msg.sender_type,
      senderName: msg.character_name || "You",
      timestamp: msg.timestamp,
    }));

  const handleRegenSelect = async (reason) => {
    if (!regenTarget) return;
    setIsRegenerating(true);
    try {
      await base44.functions.invoke('regenerateImageWithReason', {
        messageId: regenTarget.id,
        reason,
      });
    } finally {
      setIsRegenerating(false);
      setRegenTarget(null);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || !character || !conversationId) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const charName = character.name;
      const charDesc = [character.appearance_notes, character.personality_summary, character.age_range, character.gender].filter(Boolean).join(', ');
      const referenceImages = [];
      if (character.avatar_url) referenceImages.push(character.avatar_url);
      if (character.reference_image_urls?.length > 0) referenceImages.push(...character.reference_image_urls.slice(0, 3));

      const fullPrompt = `Photorealistic photo of ${charName}${charDesc ? ` (${charDesc})` : ''}. ${prompt.trim()} Natural lighting, authentic photo quality. Real photograph — not illustration.`;

      const genRes = await base44.integrations.Core.GenerateImage({
        prompt: fullPrompt,
        existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
      });

      if (!genRes?.url) throw new Error('No image URL returned');

      // Create a message in the conversation as if the character sent it
      const newMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: "character",
        character_id: character.id,
        character_name: character.name,
        content: "",
        image_url: genRes.url,
        emotional_state: character.emotional_state || "calm",
        timestamp: new Date().toISOString(),
      });

      // Store memory so character remembers sending this
      base44.entities.Memory.create({
        character_id: character.id,
        title: `Sent a photo: ${prompt.trim().substring(0, 60)}`,
        description: `You sent the user a photo based on their prompt: "${prompt.trim()}". They generated it via the media gallery.`,
        emotional_impact: 'positive',
        timestamp: new Date().toISOString(),
        source_context: `gallery_generated_${newMsg.id}`,
      }).catch(() => {});

      setPrompt("");
      setIsOpen(false);
      if (onImageGenerated) onImageGenerated(newMsg);
    } catch (err) {
      setGenerateError(err.message || "Failed to generate image");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      {/* Media button in header — always show if character exists */}
      <button
        onClick={() => setIsOpen(true)}
        className="relative p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="View media & generate photos"
      >
        <Images className="w-4 h-4" />
        {images.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
            {images.length}
          </span>
        )}
      </button>

      {/* Media modal */}
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
              onClick={() => setIsOpen(false)}
            >
              <div
                className="bg-card rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] flex flex-col gap-5"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">
                    Media {images.length > 0 ? `(${images.length})` : ""}
                  </h3>
                  <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                </div>

                {/* Generate image panel */}
                {character && conversationId && (
                  <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <p className="text-sm font-medium text-foreground">Generate a photo from {character.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Describe a scene or situation and {character.name} will "send" it to you in the chat.</p>
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder={`e.g. "at the gym after a workout" or "cooking dinner at home"`}
                      rows={2}
                      className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {generateError && <p className="text-xs text-destructive">{generateError}</p>}
                    <button
                      onClick={handleGenerate}
                      disabled={!prompt.trim() || isGenerating}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {isGenerating ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                      ) : (
                        <><Sparkles className="w-4 h-4" /> Generate & Send</>
                      )}
                    </button>
                  </div>
                )}

                {/* Image grid */}
                <div className="flex-1 overflow-y-auto">
                  {images.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No images shared yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {images.map((img, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="group relative overflow-hidden rounded-xl aspect-square"
                        >
                          <button onClick={() => setSelectedImage(img)} className="w-full h-full">
                            <img
                              src={img.url}
                              alt={`${img.senderName}'s photo`}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                            />
                          </button>
                          {/* Overlay buttons */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                            {img.senderType === "character" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setRegenTarget(img); }}
                                className="p-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
                                title="Regenerate"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </button>
                            )}
                            {onDeleteImage && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteImage(img.id); }}
                                className="p-2 rounded-full bg-destructive/80 text-white hover:bg-destructive transition-colors"
                                title="Delete"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Full image viewer */}
      {createPortal(
        <AnimatePresence>
          {selectedImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/95 z-[55] flex flex-col items-center justify-center p-4"
              onClick={() => setSelectedImage(null)}
            >
              <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{selectedImage.senderName}</p>
                <button onClick={() => setSelectedImage(null)} className="p-2 hover:bg-secondary rounded-lg transition-colors">
                  <X className="w-5 h-5 text-foreground" />
                </button>
              </div>
              <div className="flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
                <img
                  src={selectedImage.url}
                  alt="Full view"
                  className="max-w-full max-h-[75vh] object-contain rounded-xl"
                />
                <div className="flex gap-3">
                  {selectedImage.senderType === "character" && (
                    <button
                      onClick={() => { setRegenTarget(selectedImage); setSelectedImage(null); }}
                      className="px-4 py-2 rounded-lg bg-secondary border border-border text-foreground hover:border-primary/40 transition-colors flex items-center gap-2 text-sm"
                    >
                      <RefreshCw className="w-4 h-4" /> Regenerate
                    </button>
                  )}
                  {onDeleteImage && (
                    <button
                      onClick={() => { onDeleteImage(selectedImage.id); setSelectedImage(null); }}
                      className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center gap-2 text-sm"
                    >
                      <X className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Regenerate reason modal */}
      <RegenerateImageModal
        isOpen={!!regenTarget}
        onClose={() => setRegenTarget(null)}
        onSelect={handleRegenSelect}
        isRegenerating={isRegenerating}
      />
    </>
  );
}