import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Send, Plus, MessageCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import BottomNav from '@/components/BottomNav';

export default function GroupChat() {
  const navigate = useNavigate();
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);

  const { data: conversationsData = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => base44.entities.Conversation.list(),
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

  return (
    <div className="flex w-full h-full bg-slate-900 overflow-hidden flex-col">
      {/* Sidebar */}
      <div className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col hidden sm:flex">
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Conversations</h2>
            <p className="text-xs text-slate-400">{conversationsData.length} chats</p>
          </div>
          <Button size="icon" variant="ghost" className="text-slate-400 hover:text-white">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {conversationsData.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-slate-400">No conversations yet</p>
              </div>
            ) : (
              conversationsData.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`w-full text-left p-3 rounded-lg transition-all ${
                    selectedConversation?.id === conv.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700'
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
      <div className="flex-1 flex flex-col bg-slate-900">
        {selectedConversation ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-slate-700 flex items-center justify-between bg-slate-800/50">
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => setSelectedConversation(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                  <h1 className="text-lg font-semibold text-white">{selectedConversation.title}</h1>
                  <p className="text-xs text-slate-400">{selectedConversation.character_ids?.length || 0} participants</p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4 pr-4">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full min-h-64">
                    <p className="text-slate-400">No messages yet. Start the conversation!</p>
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
                            ? 'bg-blue-600 border-blue-700'
                            : 'bg-slate-700 border-slate-600'
                        }`}
                      >
                        <CardContent className="p-3">
                          <p className="text-xs font-medium mb-1 opacity-75">{msg.character_name || 'You'}</p>
                          <p className="text-sm text-white break-words">{msg.content}</p>
                        </CardContent>
                      </Card>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t border-slate-700 bg-slate-800/50 flex gap-2">
              <Input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
                className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
              />
              <Button 
                onClick={handleSendMessage} 
                size="icon"
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            <MessageCircle className="w-16 h-16 text-slate-700 mb-4" />
            <p className="text-xl font-medium text-slate-300">Select a conversation</p>
            <p className="text-sm text-slate-400 mt-2">Choose from your existing chats to start messaging</p>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}