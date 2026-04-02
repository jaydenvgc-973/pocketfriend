import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { X, Sparkles, Send, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ScenePhotoModal({ location, characters, currentUser, displayName, onClose, allCharacters }) {
  const [participants, setParticipants] = useState(characters.map(c => c.id));
  const [recipients, setRecipients] = useState(characters.map(c => c.id));
  const [prompt, setPrompt] = useState("");
  const [generatedImage, setGeneratedImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const toggleParticipant = (id) => setParticipants(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleRecipient = (id) => setRecipients(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const generate = async () => {
    setIsGenerating(true);
    const selectedChars = allCharacters.filter(c => participants.includes(c.id));
    const charNames = selectedChars.map(c => c.name).join(", ");
    const allNames = [displayName, ...selectedChars.map(c => c.name)].join(", ");
    const autoPrompt = prompt.trim() || `Candid group photo at ${location.name}, natural lighting, realistic moment`;

    // Include user avatar + character avatars as reference images
    const userAvatar = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;
    const charRefs = selectedChars.flatMap(c => c.avatar_url ? [c.avatar_url] : []);
    const allRefs = [userAvatar, ...charRefs].filter(Boolean);
    const firstImage = location?.zones?.find(z => z.image_urls?.length > 0)?.image_urls?.[0] || null;
    const refImages = [...allRefs, ...(firstImage ? [firstImage] : [])].slice(0, 4);

    try {
      const result = await base44.integrations.Core.GenerateImage({
        prompt: `${autoPrompt}. People in the photo: ${allNames}. Location: ${location.name}. Include ALL people listed. Photorealistic, candid, authentic moment.`,
        existing_image_urls: refImages.length > 0 ? refImages : undefined,
      });
      setGeneratedImage(result.url);
    } catch {
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
            {characters.map(char => (
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
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={`Candid shot at ${location.name}...`}
            className="w-full h-10 px-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground"
          />
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
              {characters.map(char => (
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