import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Send } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import BottomNav from '@/components/BottomNav';
import { Button } from '@/components/ui/button';

export default function GroupChat() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const messagesEndRef = useRef(null);

  const { data: conversation } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => base44.entities.Conversation.get(conversationId),
    enabled: !!conversationId,
  });

  const { data: messagesData = [] } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => base44.entities.Message.filter({ conversation_id: conversationId }),
    enabled: !!conversationId,
  });

  useEffect(() => {
    setMessages(messagesData);
  }, [messagesData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!conversationId) return;

    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.data?.conversation_id === conversationId && event.type === 'create') {
        setMessages(prev => [...prev, event.data]);
      }
    });

    return unsubscribe;
  }, [conversationId]);

  const handleSendMessage = async () => {
    if (!messageText.trim() || !conversationId) return;

    try {
      await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'user',
        content: messageText,
        timestamp: new Date().toISOString(),
      });
      setMessageText('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  if (!conversation) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <div className="bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate('/groups')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{conversation.title}</h2>
          <p className="text-xs text-muted-foreground">{conversation.character_ids?.length || 0} participants</p>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
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
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-card/50 p-4 flex-shrink-0 mb-[60px]">
        <div className="max-w-lg mx-auto flex gap-2">
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Type a message..."
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button onClick={handleSendMessage} size="icon" disabled={!messageText.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}