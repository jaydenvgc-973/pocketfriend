import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Send, Plus, MessageCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AnimatePresence } from 'framer-motion';
import { buildSystemPrompt } from '@/lib/defaultCharacter';
import BottomNav from '@/components/BottomNav';
import CharacterSelector from '@/components/groupchat/CharacterSelector';
import MessageBubble from '@/components/chat/MessageBubble';
import TypingIndicator from '@/components/chat/TypingIndicator';

export default function GroupChat() {
  const queryClient = useQueryClient();
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [showCharacterSelector, setShowCharacterSelector] = useState(false);
  const [typingCharacter, setTypingCharacter] = useState(null);
  const scrollRef = useRef(null);
  const messagesRef = useRef([]);

  const { data: conversationsData = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => base44.entities.Conversation.filter({ type: 'group' }),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters'],
    queryFn: () => base44.entities.Character.list('-created_date'),
  });

  const createGroupMutation = useMutation({
    mutationFn: async (characterIds) => {
      const selectedCharacters = characters.filter(c => characterIds.includes(c.id));
      const characterNames = selectedCharacters.map(c => c.name).join(', ');
      return await base44.entities.Conversation.create({
        title: characterNames,
        type: 'group',
        character_ids: characterIds,
      });
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
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
  }, [messagesData, selectedConversation?.id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingCharacter]);

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

    // Save user message
    const userMsg = await base44.entities.Message.create({
      conversation_id: selectedConversation.id,
      sender_type: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    });
    setMessages(prev => [...prev, userMsg]);

    // Fetch the characters in this conversation
    const convoCharacters = characters.filter(c =>
      selectedConversation.character_ids?.includes(c.id)
    );

    // Each character responds one at a time so they can "hear" each other
    const currentMessages = [...messages, userMsg];

    for (const character of convoCharacters) {
      setTypingCharacter(character);

      // Build the full group conversation history this character sees
      const historyLines = currentMessages
        .map(m => `${m.sender_type === 'user' ? 'User' : m.character_name}: ${m.content}`)
        .join('\n');

      // Build the other participants list so the character knows who else is in the group
      const otherParticipants = convoCharacters
        .filter(c => c.id !== character.id)
        .map(c => c.name)
        .join(', ');

      const systemPrompt = character.system_prompt || buildSystemPrompt(character);

      const fullPrompt = `${systemPrompt}

YOU ARE IN A GROUP CHAT with: ${otherParticipants || 'just you and the user'}.
You are aware of this group conversation and all the messages in it. You can respond to anyone — the user or the other characters.

Your current emotional state: ${character.emotional_state || 'calm'}.
Your current life situation: ${character.current_situation || ''}.
${character.current_life_event ? `What is on your mind right now: ${character.current_life_event}` : ''}

Group conversation so far:
${historyLines}

Write ONLY your next reply as ${character.name}. Do NOT include your name as a label. Keep it natural, short, and in your character's voice. React to what was just said.`;

      let responseText = '';
      try {
        const response = await base44.integrations.Core.InvokeLLM({ prompt: fullPrompt });
        responseText = response.replace(/^[\w\s]+:\s*/i, '').trim();
      } catch (err) {
        setTypingCharacter(null);
        continue;
      }

      const charMsg = await base44.entities.Message.create({
        conversation_id: selectedConversation.id,
        sender_type: 'character',
        character_id: character.id,
        character_name: character.name,
        content: responseText,
        emotional_state: character.emotional_state || 'calm',
        timestamp: new Date().toISOString(),
      });

      currentMessages.push(charMsg);
      setMessages(prev => [...prev, charMsg]);
    }

    setTypingCharacter(null);

    // Update conversation preview
    await base44.entities.Conversation.update(selectedConversation.id, {
      last_message_preview: text.substring(0, 100),
      last_message_date: new Date().toISOString(),
    });
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
      {/* Header */}
      <div className="bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <Link to="/home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-sm font-semibold text-foreground">Group Chats</h2>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col gap-4 p-4 min-h-0">
        {/* Conversations List */}
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
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversation(conv)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-all text-xs ${
                      selectedConversation?.id === conv.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-secondary'
                    }`}
                  >
                    {conv.title}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Chat Area */}
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
                <AnimatePresence>
                  {typingCharacter && (
                    <TypingIndicator name={typingCharacter.name} avatarUrl={typingCharacter.avatar_url} />
                  )}
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
                  disabled={!!typingCharacter}
                  className="flex-1 bg-transparent text-foreground text-xs border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary placeholder:text-muted-foreground disabled:opacity-50"
                />
                <Button
                  size="icon"
                  onClick={handleSendMessage}
                  disabled={!messageText.trim() || !!typingCharacter}
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
            onConfirm={(selectedIds) => createGroupMutation.mutate(selectedIds)}
            onCancel={() => setShowCharacterSelector(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}