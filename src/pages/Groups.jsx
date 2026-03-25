import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Users, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { formatDistanceToNowStrict } from 'date-fns';
import BottomNav from "@/components/BottomNav";

export default function Groups() {
  const { data: groupConversations = [], isLoading } = useQuery({
    queryKey: ['groupConversations'],
    queryFn: () => base44.entities.Conversation.filter({ type: 'group' }, '-last_message_date'),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters'],
    queryFn: () => base44.entities.Character.list(),
  });

  const getCharacterNames = (characterIds) => {
    if (!characters || characters.length === 0 || !characterIds) return '';
    const names = characterIds.map(id => {
      const char = characters.find(c => c.id === id);
      return char ? char.name : 'Unknown';
    });
    return names.join(', ');
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-sm font-semibold">Groups</h2>
      </div>
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <Link to="/group-chat">
          <motion.div
            whileTap={{ scale: 0.98 }}
            className="border border-border rounded-2xl p-6 flex items-center gap-4 cursor-pointer hover:border-primary/30 transition-colors bg-card"
          >
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">New Group Chat</p>
              <p className="text-xs text-muted-foreground mt-0.5">Get multiple characters talking</p>
            </div>
          </motion.div>
        </Link>

        {groupConversations.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">Your Group Chats</h3>
            <div className="space-y-2">
              {groupConversations.map(conv => (
                <Link to={`/group-chat?conversationId=${conv.id}`} key={conv.id}>
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-4 bg-card border border-border rounded-2xl px-4 py-3 hover:border-primary/30 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <MessageCircle className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-semibold text-foreground truncate">{conv.title}</span>
                        {conv.last_message_date && (
                          <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                            {formatDistanceToNowStrict(new Date(conv.last_message_date), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {getCharacterNames(conv.character_ids)}
                      </p>
                    </div>
                  </motion.div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
      <BottomNav />
    </div>
  );
}