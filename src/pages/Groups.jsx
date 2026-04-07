import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Users, MessageCircle, Edit2, Trash2, X } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { formatDistanceToNowStrict } from 'date-fns';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";

export default function Groups() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const { data: currentUser = null } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: groupConversations = [], isLoading } = useQuery({
    queryKey: ['groupConversations', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Conversation.filter({ type: 'group', created_by: currentUser.email }, '-last_message_date')
      : [],
    enabled: !!currentUser?.email,
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  const updateGroupMutation = useMutation({
    mutationFn: (args) => base44.entities.Conversation.update(args.id, { title: args.title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groupConversations', currentUser?.email] });
      setEditingId(null);
      setEditTitle('');
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id) => base44.entities.Conversation.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groupConversations', currentUser?.email] });
      setConfirmDeleteId(null);
    },
  });

  const getCharacterNames = (characterIds) => {
    if (!characters || characters.length === 0 || !characterIds) return '';
    const names = characterIds.map(id => {
      const char = characters.find(c => c.id === id);
      return char ? char.name : 'Unknown';
    });
    return names.join(', ');
  };

  const handleStartEdit = (conv) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const handleSaveEdit = () => {
    if (editTitle.trim()) {
      updateGroupMutation.mutate({ id: editingId, title: editTitle.trim() });
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="sticky top-0 z-[1000] bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 pointer-events-auto">
        <Link to="/home" className="p-2 -ml-2 text-muted-foreground hover:text-foreground pointer-events-auto cursor-pointer"><ArrowLeft className="w-5 h-5" /></Link>
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
                <div key={conv.id} className="group relative">
                  {editingId === conv.id ? (
                    <div className="flex gap-2 items-center bg-card border border-border rounded-2xl px-4 py-3">
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 text-sm"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                        disabled={!editTitle.trim()}
                        className="h-8"
                      >
                        Save
                      </Button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-muted-foreground hover:text-foreground p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Link to={`/group-chat?conversationId=${conv.id}`}>
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
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        {confirmDeleteId === conv.id ? (
                          <div className="flex gap-1 items-center bg-card border border-border rounded-lg px-2 py-1">
                            <span className="text-xs text-muted-foreground">Delete?</span>
                            <button
                              onClick={() => deleteGroupMutation.mutate(conv.id)}
                              className="text-[10px] text-destructive bg-destructive/10 px-2 py-0.5 rounded hover:bg-destructive/20"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[10px] text-muted-foreground px-2 py-0.5 rounded hover:bg-secondary"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={(e) => { e.preventDefault(); handleStartEdit(conv); }}
                              className="p-1.5 text-muted-foreground hover:text-foreground bg-secondary rounded-lg transition-colors"
                              title="Edit title"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.preventDefault(); setConfirmDeleteId(conv.id); }}
                              className="p-1.5 text-muted-foreground hover:text-destructive bg-secondary rounded-lg transition-colors"
                              title="Delete chat"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <BottomNav />
    </div>
  );
}