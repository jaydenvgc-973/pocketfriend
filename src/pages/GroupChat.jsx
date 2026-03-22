import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Send, Plus } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AnimatePresence } from 'framer-motion';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import BottomNav from '@/components/BottomNav';
import CharacterSelector from '@/components/groupchat/CharacterSelector';

export default function GroupChat() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [showCharacterSelector, setShowCharacterSelector] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const isNewConversation = conversationId === 'new';

  const { data: conversation, isLoading: conversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => conversationId !== 'new' ? base44.entities.Conversation.get(conversationId) : null,
    enabled: conversationId !== 'new',
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters'],
    queryFn: () => base44.entities.Character.list('-created_date'),
  });

  const { data: messagesData = [] } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => conversationId !== 'new' && conversation ? base44.entities.Message.filter({ conversation_id: conversation.id }) : [],
    enabled: !!conversation,
  });

  useEffect(() => {
    if (messagesData.length > 0 || conversation) {
      setMessages(messagesData);
    }
  }, [messagesData, conversation?.id]);

  useEffect(() => {
    if (!conversation) return;

    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.data?.conversation_id === conversation.id && event.data?.sender_type === 'character') {
        setTypingUsers(prev => {
          const isTyping = prev.find(u => u.character_id === event.data.character_id);
          if (!isTyping && event.type === 'create') {
            const newTyping = [...prev, { character_id: event.data.character_id, name: event.data.character_name }];
            setTimeout(() => {
              setTypingUsers(p => p.filter(u => u.character_id !== event.data.character_id));
            }, 2000);
            return newTyping;
          }
          return prev;
        });
      }
    });

    return unsubscribe;
  }, [conversation?.id]);

  const createGroupMutation = useMutation({
    mutationFn: async (characterIds) => {
      const selectedCharacters = characters.filter(c => characterIds.includes(c.id));
      const characterNames = selectedCharacters.map(c => c.name).join(', ');
      
      const newConversation = await base44.entities.Conversation.create({
        title: characterNames,
        type: 'group',
        character_ids: characterIds,
      });
      return newConversation;
    },
    onSuccess: (newConversation) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setShowCharacterSelector(false);
      navigate(`/group-chat/${newConversation.id}`);
    },
  });

  const handleSendMessage = async () => {
    if (!messageText.trim() || !conversation) return;

    try {
      await base44.entities.Message.create({
        conversation_id: conversation.id,
        sender_type: 'user',
        content: messageText,
      });
      setMessageText('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (conversationLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  const activeCharacters = characters.filter(c => c.status === 'active' || c.status === 'moved_away' || !c.status);

  if (isNewConversation) {
    return (
      <div className="h-screen flex flex-col bg-background pb-[60px]">
        <div className="bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => navigate('/groups')} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-sm font-semibold text-foreground">New Group Chat</h2>
        </div>

        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-xl font-medium text-foreground mb-4">Select characters to create a group</p>
          <button
            onClick={() => setShowCharacterSelector(true)}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4 inline mr-2" />
            Select Characters
          </button>
        </div>

        <AnimatePresence>
          {showCharacterSelector && (
            <CharacterSelector
              characters={activeCharacters}
              onConfirm={(selectedIds) => createGroupMutation.mutate(selectedIds)}
              onCancel={() => setShowCharacterSelector(false)}
            />
          )}
        </AnimatePresence>

        <BottomNav />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="h-screen flex flex-col bg-background pb-[60px] items-center justify-center">
        <p className="text-muted-foreground">Conversation not found</p>
        <button onClick={() => navigate('/groups')} className="text-primary mt-4 text-sm">
          Back to groups
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background pb-[60px]">
      {/* Header */}
      <div className="bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate('/groups')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{conversation.title}</h2>
          <p className="text-xs text-muted-foreground">{conversation.character_ids?.length || 0} participants</p>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4 p-4 max-w-lg mx-auto w-full">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">No messages yet. Start the conversation!</p>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="flex flex-col gap-1 max-w-xs">
                  <Card className={`${msg.sender_type === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                    <CardContent className="p-3">
                      <p className="text-xs font-medium mb-1 opacity-75">{msg.character_name || 'You'}</p>
                      <p className="text-sm break-words">{msg.content}</p>
                    </CardContent>
                  </Card>
                  <p className={`text-xs opacity-60 ${msg.sender_type === 'user' ? 'text-right' : 'text-left'}`}>
                    {msg.timestamp ? formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true }) : ''}
                  </p>
                </div>
              </div>
            ))
          )}
          {typingUsers.length > 0 && (
            <div className="flex justify-start">
              <div className="text-xs text-muted-foreground italic">
                {typingUsers.map(u => u.name).join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border bg-card/50 p-4 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <div className="flex items-end gap-2 bg-secondary rounded-2xl p-2">
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Say something..."
              rows={1}
              className="flex-1 bg-transparent text-foreground text-sm resize-none outline-none px-3 py-2 max-h-32 placeholder:text-muted-foreground"
              style={{ minHeight: '40px' }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageText.trim()}
              className="p-2 rounded-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <Send className="w-4 h-4 text-primary-foreground" />
            </button>
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}