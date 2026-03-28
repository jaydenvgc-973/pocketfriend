import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Send, Plus, MessageCircle, Trash2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AnimatePresence } from 'framer-motion';
import BottomNav from '@/components/BottomNav';
import CharacterSelector from '@/components/groupchat/CharacterSelector';
import MessageBubble from '@/components/chat/MessageBubble';

export default function GroupChat() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const initialConversationId = urlParams.get('conversationId');
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [showCharacterSelector, setShowCharacterSelector] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const scrollRef = useRef(null);
  const messagesRef = useRef([]);

  const { data: currentUser = null } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: conversationsData = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ['conversations', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Conversation.filter({ type: 'group', created_by: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email }, '-created_date')
      : [],
    enabled: !!currentUser?.email,
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (convId) => base44.entities.Conversation.delete(convId),
    onSuccess: (_, convId) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', currentUser?.email] });
      if (selectedConversation?.id === convId) {
        setSelectedConversation(null);
        setMessages([]);
      }
      setConfirmDeleteId(null);
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: async (args) => {
      const { characterIds, title } = args;
      const selectedCharacters = characters.filter(c => characterIds.includes(c.id));
      const characterNames = selectedCharacters.map(c => c.name).join(', ');
      const chatTitle = title || characterNames;
      return await base44.entities.Conversation.create({
        title: chatTitle,
        type: 'group',
        character_ids: characterIds,
      });
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', currentUser?.email] });
      setShowCharacterSelector(false);
      setSelectedConversation(conversation);
    },
  });

  const { data: messagesData = [] } = useQuery({
    queryKey: ['messages', selectedConversation?.id],
    queryFn: () => selectedConversation
      ? base44.entities.Message.filter({ conversation_id: selectedConversation.id }, 'created_date', 100)
      : [],
    enabled: !!selectedConversation,
  });

  useEffect(() => {
    setMessages(messagesData);
    messagesRef.current = messagesData;
  }, [messagesData, selectedConversation?.id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (initialConversationId && conversationsData.length > 0 && !selectedConversation) {
      const convoToSelect = conversationsData.find(c => c.id === initialConversationId);
      if (convoToSelect) {
        setSelectedConversation(convoToSelect);
      }
    }
  }, [initialConversationId, conversationsData, selectedConversation]);

  useEffect(() => {
    if (selectedConversation) {
      const draftKey = `groupchat_draft_${selectedConversation.id}`;
      const savedDraft = localStorage.getItem(draftKey);
      if (savedDraft) {
        setMessageText(savedDraft);
      }
    }
  }, [selectedConversation?.id]);

  useEffect(() => {
    if (selectedConversation) {
      const draftKey = `groupchat_draft_${selectedConversation.id}`;
      if (messageText) {
        localStorage.setItem(draftKey, messageText);
      } else {
        localStorage.removeItem(draftKey);
      }
    }
  }, [messageText, selectedConversation?.id]);

  useEffect(() => {
    if (!selectedConversation) return;
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.data?.conversation_id === selectedConversation.id) {
        queryClient.invalidateQueries({ queryKey: ['messages', selectedConversation.id] });
      }
    });
    return unsubscribe;
  }, [selectedConversation?.id, queryClient]);

  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedConversation) return;

    const text = messageText;
    setMessageText('');
    const draftKey = `groupchat_draft_${selectedConversation.id}`;
    localStorage.removeItem(draftKey);

    const userMsg = await base44.entities.Message.create({
      conversation_id: selectedConversation.id,
      sender_type: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    });
    setMessages(prev => [...prev, userMsg]);

    await base44.entities.Conversation.update(selectedConversation.id, {
      last_message_preview: text.substring(0, 100),
      last_message_date: new Date().toISOString(),
    });

    await base44.functions.invoke('generateGroupChatResponse', { messageId: userMsg.id });
  };

  if (conversationsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const activeCharacters = characters.filter(c => c.status === 'active' || c.status === 'moved_away' || !c.status);

  return (
    <div className="fixed inset-0 flex flex-col bg-background pb-[60px]">
      <div className="bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <Link to="/home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-sm font-semibold text-foreground">Group Chats</h2>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col gap-4 p-4 min-h-0">
        <div className="flex flex-col border border-border rounded-2xl bg-card/30 overflow-hidden flex-shrink-0 h-24">
          <div className="p-3 border-b border-border flex items-center justify-between flex-shrink-0">
            <h3 className="text-xs font-semibold uppercase tracking-wide">Conversations</h3>
            <button onClick={() => setShowCharacterSelector(true)} className="text-muted-foreground hover:text-foreground">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-1 p-2">
              {conversationsData.length === 0 ? (
                <p className="text-xs text-muted-foreground p-1">No group chats yet</p>
              ) : (
                conversationsData.map(conv => (
                  <div key={conv.id} className="group relative flex items-center gap-1">
                    <button
                      onClick={() => setSelectedConversation(conv)}
                      className={`flex-1 text-left px-3 py-2 rounded-lg transition-all text-xs ${
                        selectedConversation?.id === conv.id
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground hover:bg-secondary'
                      }`}
                    >
                      {conv.title}
                    </button>
                    {confirmDeleteId === conv.id ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => deleteGroupMutation.mutate(conv.id)}
                          className="text-[10px] text-destructive bg-destructive/10 px-2 py-1 rounded-md hover:bg-destructive/20"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[10px] text-muted-foreground px-1 py-1 rounded-md hover:bg-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(conv.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {selectedConversation ? (
          <div className="flex-1 flex flex-col border border-border rounded-2xl bg-card/30 overflow-hidden min-w-0">
            <div className="p-4 border-b border-border flex-shrink-0">
              <h1 className="text-sm font-semibold text-foreground">{selectedConversation.title}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedConversation.character_ids?.length || 0} participants
              </p>
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="py-4 space-y-1">
                <AnimatePresence>
                  {messages.map(msg => (
                    <MessageBubble key={msg.id} message={msg} showName={msg.sender_type === 'character'} />
                  ))}
                </AnimatePresence>
                <div ref={scrollRef} />
              </div>
            </ScrollArea>

            <div className="p-3 border-t border-border bg-card/50 flex-shrink-0">
              <div className="flex items-end gap-2">
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Say something..."
                  className="flex-1 bg-transparent text-foreground text-xs border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary placeholder:text-muted-foreground"
                />
                <Button
                  size="icon"
                  onClick={handleSendMessage}
                  disabled={!messageText.trim()}
                  className="h-8 w-8 bg-primary hover:bg-primary/90"
                >
                  <Send className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-border rounded-2xl">
            <MessageCircle className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">Select a conversation</p>
            <p className="text-xs text-muted-foreground mt-1">Pick one from above to start chatting</p>
          </div>
        )}
      </div>

      <BottomNav />

      <AnimatePresence>
        {showCharacterSelector && (
          <CharacterSelector
            characters={activeCharacters}
            onConfirm={(selectedIds, groupTitle) => createGroupMutation.mutate({ characterIds: selectedIds, title: groupTitle })}
            onCancel={() => setShowCharacterSelector(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}