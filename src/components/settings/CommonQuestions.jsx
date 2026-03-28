import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const FAQS = [
  {
    q: `What does the "!" on a character's card mean? Why doesn't it go away when I enter the chat?`,
    a: `The "!" means that character has a message queued and ready to be delivered to your chat — think of it as them "about to say something." It's different from an unread message (one that's already appeared). The badge disappears once that pending message actually shows up in your conversation, which may take a moment depending on timing settings.`,
  },
  {
    q: "What do the colored rings around character avatars mean?",
    a: "The ring color reflects a character's current emotional state. Green means calm, orange means irritated, red means defensive, blue means reflective, and so on. It's a quick visual cue for how they're feeling before you even open the chat.",
  },
  {
    q: "My character has a moon icon — what does that mean?",
    a: "It means they're sleeping! Characters follow realistic sleep schedules. While asleep, they won't send new messages or respond right away. They'll be back when they wake up.",
  },
  {
    q: "How do I create a new character?",
    a: `Tap "Create" in the bottom navigation bar. You'll walk through a guided setup to define their personality, background, appearance, and relationships. You can have up to 7 custom characters active at once.`,
  },
  {
    q: "What are Moments, and how do achievements work?",
    a: `Moments is your progress hub — found via the star icon in the bottom nav. Achievements unlock naturally as you interact with characters in meaningful ways. They're not something you grind for; they happen organically through real conversations and choices.`,
  },
  {
    q: "What are daily challenges?",
    a: "Daily challenges are short goals that appear each day to give your interactions more direction. They refresh regularly and range from social tasks to emotional ones. You can check them in the Moments section.",
  },
  {
    q: "Can characters reach out to me on their own?",
    a: "Yes! Characters can send proactive messages when they have something on their mind or when something happens in their life. This depends on their personality and your schedule settings — you can tell characters when you're usually available under \"Your Schedule\" above.",
  },
  {
    q: "What is \"Response Lag\" and should I turn it off?",
    a: "Response Lag adds a realistic delay before a character replies, simulating the time it would take a real person to respond. It makes interactions feel more natural. You can turn it off if you prefer instant replies.",
  },
  {
    q: "What does \"Your Name in This World\" do?",
    a: "This is the name characters will use when talking to or about you inside conversations. If you leave it blank, characters won't refer to you by name. You can set a nickname, your real name, or anything you like.",
  },
  {
    q: "Can a character be removed without deleting them?",
    a: `Yes — you can use "They moved away" from a character's card menu. This keeps them in your world but marks them as having left. They can move back later if you want to reconnect.`,
  },
  {
    q: "Why does the simulation tool sometimes show things happening after what I typed?",
    a: "The simulation tracks timed commitments made during interactions. If characters make plans with a specific time — like \"I'll meet you at 8\" — the system saves that as a scheduled event. When that time arrives, a narrative message automatically appears in the chat confirming it happened, even if you're not actively chatting. It's designed to make the world feel like it keeps moving on its own.",
  },
  {
    q: "What is the simulation tool and how does it work?",
    a: "The simulation tool lets you place two or more characters in a scene together and watch how they interact based on their personalities, history, and emotional states. You can optionally type a situation to drop them into. The AI generates realistic dialogue, shifts in their relationship levels, and even plans or events that carry forward into their individual chat timelines.",
  },
  {
    q: "Do simulated interactions actually affect my characters?",
    a: "Yes — simulations are real. Friendship, attraction, romantic, and respect levels all update based on what happens in the scene. If characters make plans, those plans get scheduled and will surface later in their chats. Memories from the interaction are stored too, so characters may reference what happened when you talk to them individually.",
  },
  {
    q: "Why do I only see the last 50 messages in chat?",
    a: "To keep the app fast and stable, only the most recent 50 messages show in your active chat. Older messages are safely archived and not lost — they're just hidden to improve performance. Character memories, relationship levels, and personality awareness all continue working normally using archived data and memory records. If you need to see older messages, contact support.",
  },
  {
    q: "Are my old messages deleted?",
    a: "No. Messages older than 50 are archived, not deleted. They're preserved in our system and used to maintain character memories and personality continuity. Your full conversation history is safe.",
  },
  {
    q: "How do characters remember old conversations?",
    a: "Character memories are stored separately from active chat messages. As you interact, significant moments are saved as memories that characters can reference later. This means they'll naturally bring up things from earlier conversations without needing those messages visible in the active chat.",
  },
  {
    q: "Can I expand storage and keep more messages visible?",
    a: "Yes — this is optional. If you want to keep more chat history visible and expand media storage, you can connect your own cloud storage (Google Drive or similar) in your account settings. This lets you store unlimited archived messages and media without relying on the app's default limits. Setup instructions are in the Storage & Backup section below.",
  },
  {
    q: "How do I set up optional cloud storage?",
    a: "In Settings, look for \"Storage & Backup.\" You can authorize your Google Drive or similar cloud storage service. Once connected, older messages and media are automatically archived to your account instead of the app's servers. This is completely optional — the app works fine without it. Without it, the app stores messages in its default archive after 50 messages become visible, keeping performance light. If you want to keep extended history accessible, setting up optional cloud storage lets you do that.",
  },
  {
    q: "Do I need to set up voice generation (TTS)?",
    a: "No — voice is optional. If you don't set it up, characters will reply in text only. If you want characters to speak, you can optionally connect your own OpenAI API key in Settings under \"Voice Setup.\" This lets you generate voice audio without the app using shared resources. Setup takes 2 minutes and requires an OpenAI account with a small API credit balance.",
  },
  {
    q: "Where do I find my OpenAI API key?",
    a: "Go to platform.openai.com, sign in with your OpenAI account, click \"API keys\" in the sidebar, and create a new key. Copy it, then paste it into the Voice Setup section in your app Settings. OpenAI charges per request — typically a few cents per character voice line.",
  },
  {
    q: "What happens if I don't connect optional features?",
    a: "The app works perfectly fine without them. You'll get the default experience: text-only chats, limited message history visible (most recent 50), and standard performance. Optional features like cloud storage and voice just expand what's possible. They're there if you want them, not required to enjoy the app.",
  },
  ];

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <button
        className="w-full flex items-center justify-between gap-3 py-3.5 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-sm font-medium text-foreground">{q}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-sm text-muted-foreground pb-4 leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function CommonQuestions() {
  return (
    <div className="pt-4 border-t border-border">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Common Questions</p>
      <div className="bg-card border border-border rounded-2xl px-4">
        {FAQS.map((faq, i) => (
          <FAQItem key={i} q={faq.q} a={faq.a} />
        ))}
      </div>
    </div>
  );
}