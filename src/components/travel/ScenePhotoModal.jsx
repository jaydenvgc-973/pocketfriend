import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { X, Sparkles, Send, Check, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildPhotoGenerationPrompt, extractPhotoAvatarUrls, validatePhotoGenerationInput, logPhotoGenerationState } from "@/lib/scenePhotoIdentityLock";

export default function ScenePhotoModal({ location, characters, currentUser, displayName, onClose, allCharacters }) {
  const [participants, setParticipants] = useState(characters.map(c => c.id));
  const [recipients, setRecipients] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const generatePrompt = async () => {
    setIsGeneratingPrompt(true);
    const selectedChars = allCharacters.filter(c => participants.includes(c.id));
    const allNames = [displayName, ...selectedChars.map(c => c.name)].join(", ");
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Write a short, creative photo caption/description (1 sentence) for a candid photo taken at ${location.name} featuring ${allNames}. Make it feel natural and spontaneous, like what you'd write as a photo prompt. No hashtags.`,
      });
      setPrompt(typeof result === "string" ? result : result?.text || "");
    } catch {
      // ignore
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const toggleParticipant = (id) => setParticipants(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleRecipient = (id) => setRecipients(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const generate = async () => {
    setIsGenerating(true);
    const selectedChars = allCharacters.filter(c => participants.includes(c.id));
    const autoPrompt = prompt.trim() || `Candid group photo at ${location.name}, natural lighting, realistic moment`;

    // STRICT IDENTITY LOCK: Extract user + character avatars as hard references
    const userAvatar = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;
    const avatarUrls = extractPhotoAvatarUrls(selectedChars, userAvatar);
    
    // Validate generation input
    logPhotoGenerationState(participants, selectedChars, userAvatar);
    
    // Location background (secondary reference only)
    const firstImage = location?.zones?.find(z => z.image_urls?.length > 0)?.image_urls?.[0] || null;
    const refImages = [...avatarUrls, ...(firstImage ? [firstImage] : [])].slice(0, 6);

    try {
      // Build prompt with STRICT identity lock enforcement
      const finalPrompt = buildPhotoGenerationPrompt(autoPrompt, selectedChars, location, displayName);
      
      console.log('[Photo] Generating with strict identity lock:', {
        avatarCount: avatarUrls.length,
        people: selectedChars.map(c => `${c.name}(age:${c.age || '?'})`).join(', '),
        totalRefs: refImages.length,
      });

      const result = await base44.integrations.Core.GenerateImage({
        prompt: finalPrompt,
        existing_image_urls: refImages.length > 0 ? refImages : undefined,
      });
      
      // Validate generation succeeded
      const validation = validatePhotoGenerationInput(selectedChars, result.url);
      if (!validation.valid) {
        console.error('[Photo] Validation failed:', validation.error);
        setGeneratedImage(null);
      } else {
        setGeneratedImage(result.url);
      }
    } catch (err) {
      console.error('[Photo] Generation failed:', err.message);
      setGeneratedImage(null);
    } finally {
      setIsGenerating(false);
    }
  };

  const sendToChats = async () => {
    if (!generatedImage || recipients.length === 0) return;
    setIsSending(true);

    for (const charId of recipients) {
      const char = allCharacters.find(c => c.id === charId);
      if (!char) continue;

      // Find or create direct conversation for this character
      const convos = await base44.entities.Conversation.filter({
        type: "direct",
        character_ids: [charId],
      });
      const directConvos = convos.filter(c => c.character_ids?.length === 1 && c.character_ids[0] === charId);

      let convoId = directConvos[0]?.id;
      if (!convoId) {
        const newConvo = await base44.entities.Conversation.create({
          title: `Chat with ${char.name}`,
          type: "direct",
          character_ids: [charId],
        });
        convoId = newConvo.id;
      }

      // Create image message in chat
      await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "user",
        content: `📸 from ${location.name}`,
        image_url: generatedImage,
        timestamp: new Date().toISOString(),
      });

      // Update conversation preview
      base44.entities.Conversation.update(convoId, {
        last_message_preview: `📸 Photo from ${location.name}`,
        last_message_date: new Date().toISOString(),
      }).catch(() => {});
    }

    setIsSending(false);
    setSent(true);
    setTimeout(onClose, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Scene Photo</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>

        {/* Participants */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Who's in the photo?</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {/* user always included */}}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border bg-primary/10 border-primary text-primary"
            >
              <Check className="w-3 h-3" /> {displayName}
            </button>
            {[
              ...characters.filter(c => c.character_type !== 'npc' && c.character_type !== 'family_npc' && c.character_type !== 'background'),
              ...characters.filter(c => c.character_type === 'npc' || c.character_type === 'promoted_npc'),
              ...characters.filter(c => c.character_type === 'family_npc' || c.character_type === 'background'),
            ].map(char => (
              <button
                key={char.id}
                onClick={() => toggleParticipant(char.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  participants.includes(char.id) ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-muted-foreground"
                }`}
              >
                {participants.includes(char.id) && <Check className="w-3 h-3" />}
                {char.name}
              </button>
            ))}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Describe the moment (optional)</p>
          <div className="flex gap-2">
            <input
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={`Candid shot at ${location.name}...`}
              className="flex-1 h-10 px-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground"
            />
            <button
              onClick={generatePrompt}
              disabled={isGeneratingPrompt}
              className="h-10 px-3 rounded-xl bg-secondary border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 flex items-center gap-1.5 text-xs"
              title="Generate prompt with AI"
            >
              <Wand2 className={`w-3.5 h-3.5 ${isGeneratingPrompt ? "animate-spin" : ""}`} />
              {isGeneratingPrompt ? "..." : "AI"}
            </button>
          </div>
        </div>

        {/* Generate */}
        <Button onClick={generate} disabled={isGenerating} className="w-full rounded-xl gap-2">
          <Sparkles className="w-4 h-4" />
          {isGenerating ? "Generating..." : generatedImage ? "Regenerate" : "Generate Photo"}
        </Button>

        {/* Preview */}
        {generatedImage && (
          <div className="rounded-xl overflow-hidden">
            <img src={generatedImage} alt="Scene photo" className="w-full aspect-video object-cover" />
          </div>
        )}

        {/* Recipients */}
        {generatedImage && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Send to</p>
            <div className="flex flex-wrap gap-2">
              {allCharacters.filter(c => !c.isNpc).map(char => (
                <button
                  key={char.id}
                  onClick={() => toggleRecipient(char.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    recipients.includes(char.id) ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-muted-foreground"
                  }`}
                >
                  {recipients.includes(char.id) && <Check className="w-3 h-3" />}
                  {char.name}
                </button>
              ))}
            </div>
            <Button
              onClick={sendToChats}
              disabled={isSending || recipients.length === 0 || sent}
              className="w-full mt-3 rounded-xl gap-2"
            >
              {sent ? <><Check className="w-4 h-4" /> Sent!</> : isSending ? "Sending..." : <><Send className="w-4 h-4" /> Send to chats</>}
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}