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
import BottomNav from '@/components/BottomNav';
import CharacterSelector from '@/components/groupchat/CharacterSelector';

export default function GroupChat() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [showCharacterSelector, setShowCharacterSelector] = useState(false);

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
    <div className="flex w-full h-full bg-background overflow-hidden">
      <div className="flex flex-col w-full">
        {/* Header */}
        <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
          <Link to="/home" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h2 className="text-sm font-semibold text-foreground">Group Chat</h2>
        </div>

      {/* Sidebar */}
      <div className="w-full sm:w-64 bg-card border-r border-border flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Conversations</h2>
            <p className="text-xs text-muted-foreground">{conversationsData.length} chats</p>
          </div>
          <Button 
            size="icon" 
            variant="ghost" 
            onClick={() => setShowCharacterSelector(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {conversationsData.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No conversations yet</p>
              </div>
            ) : (
              conversationsData.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`w-full text-left p-3 rounded-lg transition-all ${
                    selectedConversation?.id === conv.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-secondary'
                  }`}
                >
                  <p className="font-medium text-sm truncate">{conv.title}</p>
                  <p className="text-xs opacity-75 truncate mt-1">{conv.last_message_preview || 'No messages'}</p>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col bg-background">
        {selectedConversation ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-border flex items-center justify-between bg-card/50">
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => setSelectedConversation(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                  <h1 className="text-lg font-semibold text-foreground">{selectedConversation.title}</h1>
                  <p className="text-xs text-muted-foreground">{selectedConversation.character_ids?.length || 0} participants</p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4 pr-4">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full min-h-64">
                    <p className="text-muted-foreground">No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <Card
                        className={`max-w-xs ${
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
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t border-border bg-card/50 flex gap-2">
              <Input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
              />
              <Button 
                onClick={handleSendMessage} 
                size="icon"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            <MessageCircle className="w-16 h-16 text-muted-foreground mb-4" />
            <p className="text-xl font-medium text-foreground">Select a conversation</p>
            <p className="text-sm text-muted-foreground mt-2">Choose from your existing chats to start messaging</p>
          </div>
        )}
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