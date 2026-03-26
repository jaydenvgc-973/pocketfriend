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