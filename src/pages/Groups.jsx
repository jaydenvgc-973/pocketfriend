import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import BottomNav from '@/components/BottomNav';
import { formatDistanceToNow } from 'date-fns';

export default function Groups() {
  const navigate = useNavigate();

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => base44.entities.Conversation.list('-updated_date'),
  });

  const handleNewGroup = () => {
    navigate('/group-chat/new');
  };

  return (
    <div className="h-screen flex flex-col bg-background pb-[60px]">
      {/* Header */}
      <div className="bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <Link to="/home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-sm font-semibold text-foreground">Group Chats</h2>
        <button
          onClick={handleNewGroup}
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Conversations List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-lg mx-auto w-full px-4 py-4 space-y-2">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64">
              <p className="text-muted-foreground text-center">No group chats yet. Create one to get started!</p>
            </div>
          ) : (
            conversations.map(conv => (
              <motion.button
                key={conv.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate(`/group-chat/${conv.id}`)}
                className="w-full text-left p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors"
              >
                <p className="text-sm font-medium text-foreground truncate">{conv.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{conv.character_ids?.length || 0} participants</p>
                {conv.last_message_preview && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{conv.last_message_preview}</p>
                )}
                {conv.last_message_date && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(conv.last_message_date), { addSuffix: true })}
                  </p>
                )}
              </motion.button>
            ))
          )}
        </div>
      </ScrollArea>

      <BottomNav />
    </div>
  );
}