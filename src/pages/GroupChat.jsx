import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Send, Plus, MessageCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AnimatePresence } from 'framer-motion';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import BottomNav from '@/components/BottomNav';
import CharacterSelector from '@/components/groupchat/CharacterSelector';

export default function GroupChat() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [showCharacterSelector, setShowCharacterSelector] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);

  const { data: conversationsData = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => base44.entities.Conversation.list(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters'],
    queryFn: () => base44.entities.Character.list('-created_date'),
  });

  const createGroupMutation = useMutation({
    mutationFn: async (characterIds) => {
      const selectedCharacters = characters.filter(c => characterIds.includes(c.id));
      const characterNames = selectedCharacters.map(c => c.name).join(', ');
      
      const conversation = await base44.entities.Conversation.create({
        title: characterNames,
        type: 'group',
        character_ids: characterIds,
      });
      return conversation;
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setShowCharacterSelector(false);
      setSelectedConversation(conversation);
    },
  });

  const { data: messagesData = [] } = useQuery({
    queryKey: ['messages', selectedConversation?.id],
    queryFn: () => selectedConversation ? base44.entities.Message.filter({ conversation_id: selectedConversation.id }) : [],
    enabled: !!selectedConversation,
  });

  useEffect(() => {
    if (messagesData.length > 0 || selectedConversation) {
      setMessages(messagesData);
    }
  }, [messagesData, selectedConversation?.id]);

  useEffect(() => {
    if (!selectedConversation) return;

    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.data?.conversation_id === selectedConversation.id && event.data?.sender_type === 'character') {
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
  }, [selectedConversation?.id]);

  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedConversation) return;

    try {
      await base44.entities.Message.create({
        conversation_id: selectedConversation.id,
        sender_type: 'user',
        content: messageText,
      });
      setMessageText('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  if (conversationsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  const activeCharacters = characters.filter(c => c.status === 'active' || !c.status);

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Header */}
      <div className="bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-sm font-semibold text-foreground">Group Chat</h2>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-hidden">
        {selectedConversation ? (
          <div className="flex flex-col h-full">
            {/* Conversation Header */}
            <div className="p-4 border-b border-border flex items-center justify-between bg-card/50">
              <div className="flex items-center gap-3">
                <div>
                  <h1 className="text-lg font-semibold text-foreground">{selectedConversation.title}</h1>
                  <p className="text-xs text-muted-foreground">{selectedConversation.character_ids?.length || 0} participants</p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1">
              <div className="space-y-4 p-4">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-64">
                    <p className="text-muted-foreground">No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className="flex flex-col gap-1 max-w-xs">
                        <Card
                          className={`${
                            msg.sender_type === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-secondary-foreground'
                          }`}
                        >
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

            {/* Input */}
            <div className="p-4 border-t border-border bg-card/50 flex gap-2 flex-shrink-0">
              <Input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
                disabled={!selectedConversation}
              />
              <Button 
                onClick={handleSendMessage}
                size="icon"
                disabled={!messageText.trim() || !selectedConversation}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <MessageCircle className="w-16 h-16 text-muted-foreground mb-4" />
            <p className="text-xl font-medium text-foreground">Select a conversation</p>
            <p className="text-sm text-muted-foreground mt-2">Choose from your existing chats to start messaging</p>
          </div>
        )}
      </div>

      {/* Conversations Panel */}
      <div className="border-t border-border bg-card/50 p-4 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Conversations</h2>
            <button onClick={() => setShowCharacterSelector(true)} className="text-muted-foreground hover:text-foreground">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <ScrollArea className="h-24">
            <div className="flex gap-2 pr-4">
              {conversationsData.length === 0 ? (
                <p className="text-sm text-muted-foreground">No conversations yet</p>
              ) : (
                conversationsData.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversation(conv)}
                    className={`flex-shrink-0 px-3 py-2 rounded-lg transition-all text-sm whitespace-nowrap ${
                      selectedConversation?.id === conv.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-foreground hover:bg-secondary/80'
                    }`}
                  >
                    {conv.title}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Bottom Navigation - Fixed */}
      <div className="flex-shrink-0">
        <BottomNav />
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
    </div>
  );
}