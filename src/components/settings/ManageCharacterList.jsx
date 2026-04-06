import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CharacterAvatar from '@/components/chat/CharacterAvatar';

export default function ManageCharacterList() {
  const queryClient = useQueryClient();
  const [expandedMenu, setExpandedMenu] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userSettings = {} } = useQuery({
    queryKey: ['userSettings'],
    queryFn: () => base44.entities.UserSettings.list().then(list => list[0] || {}),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email }, '-created_date')
      : [],
    enabled: !!currentUser?.email,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      return base44.entities.Character.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
    },
  });

  // Organize characters by category
  const userWorldName = userSettings?.fictional_world_name || currentUser?.full_name || 'You';
  const userAvatar = userSettings?.generated_avatar_urls?.[0] || currentUser?.avatar_url;
  const userItem = currentUser ? { type: 'user', data: { ...currentUser, worldName: userWorldName, avatar_url: userAvatar } } : null;
  
  const activeChars = characters.filter(c => 
    (c.character_type === 'active' || c.character_type === 'user_created' || !c.character_type) && c.status === 'active'
  ).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  
  const npcFictitious = characters.filter(c => 
    c.character_type === 'npc' && c.status === 'active'
  ).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  
  const npcFamily = characters.filter(c => 
    c.character_type === 'family_npc' && c.status === 'active'
  ).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  
  const movedAway = characters.filter(c => 
    c.status === 'moved_away'
  ).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  
  const deleted = characters.filter(c => 
    c.status === 'deleted' || c.status === 'soft_deleted'
  ).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  const sections = [
    { title: 'You', items: userItem ? [userItem] : [], color: 'bg-primary/10' },
    { title: 'Active Characters', items: activeChars.map(c => ({ type: 'character', data: c })), color: 'bg-green-500/10' },
    { title: 'NPC Fictitious', items: npcFictitious.map(c => ({ type: 'character', data: c })), color: 'bg-purple-500/10' },
    { title: 'NPC Family', items: npcFamily.map(c => ({ type: 'character', data: c })), color: 'bg-blue-500/10' },
    { title: 'Moved Away', items: movedAway.map(c => ({ type: 'character', data: c })), color: 'bg-amber-500/10' },
    { title: 'Deleted', items: deleted.map(c => ({ type: 'character', data: c })), color: 'bg-red-500/10' },
  ];

  return (
    <div className="space-y-6">
      {sections.map(section => (
          <div key={section.title} className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{section.title} ({section.items.length})</p>
            <div className="space-y-2">
              <AnimatePresence>
                {section.items.map((item) => {
                  const itemData = item.data;
                  const itemName = item.type === 'user' 
                    ? (itemData.full_name || 'You')
                    : itemData.name;
                  const itemId = item.type === 'user' ? 'user' : itemData.id;

                  return (
                    <motion.div
                      key={itemId}
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className={`rounded-lg border border-border p-3 flex items-center justify-between ${section.color}`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {item.type === 'user' ? (
                          itemData?.avatar_url ? (
                            <img src={itemData.avatar_url} alt={itemName} className="w-8 h-8 rounded-full flex-shrink-0 object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-semibold text-primary">{itemName[0].toUpperCase()}</span>
                            </div>
                          )
                        ) : (
                          <div className="flex-shrink-0">
                            <CharacterAvatar character={itemData} size="sm" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{item.type === 'user' ? itemData.worldName : itemName}</p>
                          {item.type === 'character' && itemData.character_type && (
                            <p className="text-xs text-muted-foreground">{itemData.character_type}</p>
                          )}
                        </div>
                      </div>

                      {item.type === 'character' && (
                        <div className="relative">
                          <button
                            onClick={() => setExpandedMenu(expandedMenu === itemId ? null : itemId)}
                            className="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          {expandedMenu === itemId && (
                            <div className="absolute right-0 top-8 bg-card border border-border rounded-lg shadow-lg z-10">
                              <button
                                onClick={() => {
                                  if (window.confirm(`Delete ${itemData.name}?`)) {
                                    deleteMutation.mutate(itemId);
                                    setExpandedMenu(null);
                                  }
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-destructive hover:bg-destructive/10 rounded-lg flex items-center gap-2"
                              >
                                <Trash2 className="w-3 h-3" /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
      ))}
    </div>
  );
}