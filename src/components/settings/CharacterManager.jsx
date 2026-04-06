import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, GitMerge, ChevronDown, ChevronUp, Check, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchUnifiedRoster, getInitial } from '@/lib/unifiedRosterUtils';
import CharacterAvatar from '@/components/chat/CharacterAvatar';

const CATEGORY_OPTIONS = [
  { id: 'active', label: 'Active Character', color: 'bg-green-500/10 border-green-500/30' },
  { id: 'npc_family', label: 'NPC Family', color: 'bg-blue-500/10 border-blue-500/30' },
  { id: 'npc_fictional', label: 'NPC Fictional Person', color: 'bg-purple-500/10 border-purple-500/30' },
  { id: 'inactive', label: 'Inactive Character', color: 'bg-gray-500/10 border-gray-500/30' },
  { id: 'duplicate', label: 'Duplicate', color: 'bg-amber-500/10 border-amber-500/30' },
  { id: 'delete', label: 'Delete', color: 'bg-red-500/10 border-red-500/30' },
];

export default function CharacterManager() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState(new Map()); // key -> entry object
  const [categorizationMode, setCategorizationMode] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedForCategorization, setSelectedForCategorization] = useState(new Map());
  const [categorizations, setCategorizations] = useState(new Map()); // itemKey -> category

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userSettingsList = [] } = useQuery({
    queryKey: ['userSettings'],
    queryFn: () => base44.entities.UserSettings.list(),
    enabled: !!currentUser?.email,
  });
  const userSettings = userSettingsList[0] || {};

  const { data: roster = [] } = useQuery({
    queryKey: ['unifiedRoster', currentUser?.email],
    queryFn: () => fetchUnifiedRoster(base44, currentUser?.email),
    enabled: !!currentUser?.email,
  });

  // Organize roster into ordered categories
  // 1. User, 2. Active Characters (created_by_user: true), 3. Inactive Characters (created_by_user: true but not active), 4. Family Members, 5. NPCs
  const userItem = roster.find(e => e.is_user) ? { type: 'user', data: roster.find(e => e.is_user) } : null;
  
  const characterItems = roster
    .filter(e => e.is_character && e.status !== 'merged' && e.status !== 'deleted' && e.status !== 'soft_deleted')
    .map(c => ({ type: 'character', data: c }));
  
  const activeCharacters = characterItems
    .filter(item => item.data.created_by_user === true && item.data.status === 'active')
    .sort((a, b) => new Date(b.data.created_date) - new Date(a.data.created_date));
  
  const inactiveCharacters = characterItems
    .filter(item => item.data.created_by_user === true && item.data.status !== 'active')
    .sort((a, b) => new Date(b.data.created_date) - new Date(a.data.created_date));
  
  const familyMembers = roster
    .filter(e => e.is_family && e.status !== 'merged' && e.status !== 'deleted' && e.status !== 'soft_deleted')
    .map(f => ({ type: 'family', data: f }))
    .sort((a, b) => new Date(b.data.created_date) - new Date(a.data.created_date));
  
  const npcItems = roster
    .filter(e => e.is_world_person && e.status !== 'merged' && e.status !== 'deleted' && e.status !== 'soft_deleted')
    .map(n => ({ type: 'world_person', data: n }))
    .sort((a, b) => new Date(b.data.created_date) - new Date(a.data.created_date));
  
  const allManageableItems = [
    ...(userItem ? [userItem] : []),
    ...activeCharacters,
    ...inactiveCharacters,
    ...familyMembers,
    ...npcItems
  ];

  const renameMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('renameCharacter', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
      setRenamingId(null);
      setNewName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('deleteCharacter', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('mergeCharacters', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
      setMergeMode(false);
      setSelectedForMerge(new Map());
      setMergeConfirmModal(null);
    },
  });

  const handleRename = (charId, oldName, isNPC = false) => {
    setRenamingId(charId);
    setNewName(oldName);
  };

  const submitRename = (itemId, isNPC = false) => {
    if (!newName.trim()) {
      setRenamingId(null);
      return;
    }
    if (isNPC) {
      // Parse itemId to get sourceCharId and old personName
      const match = itemId.match(/^npc_(.+?)_(.+)$/);
      if (match && match[1]) {
        const [, sourceCharId, oldPersonName] = match;
        if (oldPersonName === newName) {
          setRenamingId(null);
          return;
        }
        const sourceChar = roster.find(c => c.id === sourceCharId && c.is_character);
        if (sourceChar) {
          const updated = (sourceChar.fictional_relationships || []).map(r =>
            r.person_name === oldPersonName ? { ...r, person_name: newName } : r
          );
          base44.entities.Character.update(sourceCharId, { fictional_relationships: updated })
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
            setRenamingId(null);
            setNewName('');
          })
            .catch(() => {});
        } else {
          setRenamingId(null);
        }
      } else {
        setRenamingId(null);
      }
    } else {
      const char = roster.find(c => c.id === itemId);
      if (!newName.trim() || newName === char?.name) {
        setRenamingId(null);
        return;
      }
      renameMutation.mutate({ characterId: itemId, newDisplayName: newName });
    }
  };

  const handleDelete = (itemId, isNPC = false) => {
    if (isNPC) {
      if (window.confirm('Remove this NPC from the world?')) {
        // Parse itemId to get sourceCharId and personName
        const match = itemId.match(/^npc_(.+?)_(.+?)_\d+$/);
        if (match) {
          const [, sourceCharId, personName] = match;
          const sourceChar = roster.find(c => c.id === sourceCharId);
          if (sourceChar) {
            const updated = (sourceChar.fictional_relationships || []).filter(
              r => r.person_name !== personName
            );
            base44.entities.Character.update(sourceCharId, { fictional_relationships: updated })
              .then(() => queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] }))
              .catch(() => {});
          }
        }
      }
    } else {
      if (window.confirm('Soft delete this character? All history is preserved and recoverable.')) {
        deleteMutation.mutate({ characterId: itemId });
      }
    }
  };

  // Auto-detect duplicates: same name appears on multiple cards
  const detectDuplicates = () => {
    const nameMap = new Map();
    const duplicateGroups = [];
    
    allManageableItems.forEach((item, idx) => {
      const itemData = item.data;
      const itemName = item.type === 'user'
        ? (userSettings.fictional_world_name || itemData.full_name || currentUser?.full_name || 'You')
        : itemData.name;
      const normalizedName = itemName.toLowerCase().trim();
      
      if (!nameMap.has(normalizedName)) {
        nameMap.set(normalizedName, []);
      }
      nameMap.get(normalizedName).push({ item, idx, itemName, type: item.type });
    });
    
    // Build groups where count >= 2
    nameMap.forEach((group, name) => {
      if (group.length >= 2) {
        duplicateGroups.push({ name, items: group });
      }
    });
    
    return duplicateGroups;
  };

  // Auto-detect orphan NPCs (NPC with no active character counterpart) + ghost NPCs
  const detectOrphanNPCs = () => {
    const activeCharIds = new Set(roster.filter(c => c.is_character && c.status === 'active').map(c => c.id));
    const orphans = [];
    const ghosts = [];
    
    allManageableItems.forEach((item, idx) => {
      const isNPC = item.type === 'world_person' || item.type === 'family';
      if (isNPC) {
        const itemData = item.data;
        const sourceCharExists = activeCharIds.has(itemData.source_character_id);
        
        // Orphan: NPC whose source character doesn't exist as active
        if (!sourceCharExists) {
          orphans.push({ item, idx, itemData });
        }
        
        // Ghost NPC: Active character exists, so NPC should be merged into it
        if (sourceCharExists) {
          ghosts.push({ item, idx, itemData, sourceCharId: itemData.source_character_id });
        }
      }
    });
    
    return { orphans, ghosts };
  };

  const [mergeConfirmModal, setMergeConfirmModal] = useState(null);

  const duplicates = detectDuplicates();
  const { orphans, ghosts } = detectOrphanNPCs();

  // selectedForMerge stores objects: { key, type, charId, sourceCharId, personName }
  const toggleMergeSelection = (entry) => {
    const updated = new Map(selectedForMerge);
    if (updated.has(entry.key)) {
      updated.delete(entry.key);
    } else {
      updated.set(entry.key, entry);
    }
    setSelectedForMerge(updated);
  };

  const submitMerge = () => {
    if (selectedForMerge.size < 2) return;
    const selectedEntries = Array.from(selectedForMerge.values());
    // item is stored directly on the entry — no lookup needed
    const selectedItems = selectedEntries.map(entry => ({ item: entry.item, entry })).filter(e => e.item);
    setMergeConfirmModal({ selectedItems, selectedEntries });
  };

  const confirmMerge = (masterEntry) => {
    if (!mergeConfirmModal) return;
    const { selectedEntries } = mergeConfirmModal;

    // Handle character-to-character merges only (not NPC deduplication)
    const charEntries = selectedEntries.filter(e => e.type === 'character');
    
    if (charEntries.length >= 2) {
      // All selected character IDs — master is designated via primaryCharacterId
      const charIds = charEntries.map(e => e.charId);
      // Get master's avatar_url to propagate
      const masterItem = charEntries.find(e => e.charId === masterEntry.charId);
      const masterAvatarUrl = masterItem?.item?.data?.avatar_url || null;
      mergeMutation.mutate({ 
        characterIds: charIds, 
        primaryCharacterId: masterEntry.charId,
        masterAvatarUrl,
        masterName: masterItem?.item?.data?.name || null,
      });
      setMergeConfirmModal(null);
    } else {
      // NPC-only merge (deduplication)
      const npcEntries = selectedEntries.filter(e => e.type === 'npc');
      const masterName = masterEntry.personName;
      
      const allChars = roster.filter(c => c.is_character || c.fictional_relationships);
      Promise.all(allChars.map(char => {
        const rels = char.fictional_relationships || [];
        const seen = new Map();
        rels.forEach(r => {
          const key = r.person_name?.toLowerCase();
          if (!key) return;
          if (!seen.has(key)) {
            seen.set(key, { ...r });
          } else {
            const existing = seen.get(key);
            seen.set(key, {
              ...existing,
              friendship_level: Math.max(existing.friendship_level ?? 50, r.friendship_level ?? 50),
              user_respect_level: Math.max(existing.user_respect_level ?? 50, r.user_respect_level ?? 50),
              romantic_level: Math.max(existing.romantic_level ?? 0, r.romantic_level ?? 0),
              attraction_level: Math.max(existing.attraction_level ?? 0, r.attraction_level ?? 0),
            });
          }
        });
        const deduped = Array.from(seen.values());
        if (deduped.length === rels.length) return Promise.resolve();
        return base44.entities.Character.update(char.id, { fictional_relationships: deduped });
      }))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
        setSelectedForMerge(new Map());
        setMergeMode(false);
        setMergeConfirmModal(null);
      })
      .catch(() => {});
    }
  };

  const editable = roster.filter(c => !c.is_protected && !c.is_default && !c.is_user);

  const handleCategorizeSubmit = () => {
    if (selectedForCategorization.size === 0 || !selectedCategory) return;
    
    const updated = new Map(categorizations);
    selectedForCategorization.forEach((entry, key) => {
      updated.set(key, selectedCategory);
    });
    setCategorizations(updated);
    
    // Show confirmation
    const categoryLabel = CATEGORY_OPTIONS.find(c => c.id === selectedCategory)?.label || selectedCategory;
    console.log(`✓ Categorized ${selectedForCategorization.size} character(s) as "${categoryLabel}"`);
    
    setSelectedForCategorization(new Map());
    setSelectedCategory(null);
    setCategorizationMode(false);
  };

  const toggleCategorizeSelection = (key) => {
    const updated = new Map(selectedForCategorization);
    if (updated.has(key)) {
      updated.delete(key);
    } else {
      updated.set(key, true);
    }
    setSelectedForCategorization(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Manage Characters</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Categorize, rename, merge, or delete characters</p>
        </div>
        {(mergeMode || categorizationMode) && (
          <Button
            size="sm"
            onClick={() => {
              setMergeMode(false);
              setSelectedForMerge(new Map());
              setCategorizationMode(false);
              setSelectedForCategorization(new Map());
              setSelectedCategory(null);
            }}
            variant="outline"
            className="rounded-lg"
          >
            Cancel
          </Button>
        )}
      </div>

      {/* Categorization Mode Selector */}
      {!categorizationMode && !mergeMode && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Categorize Characters</p>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORY_OPTIONS.map(cat => (
              <Button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setCategorizationMode(true);
                }}
                variant="outline"
                size="sm"
                className="rounded-lg justify-start"
              >
                {cat.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Categorization selection UI */}
      {categorizationMode && selectedCategory && (
        <div className={`rounded-xl border-2 p-3 space-y-2 ${CATEGORY_OPTIONS.find(c => c.id === selectedCategory)?.color}`}>
          <p className="text-xs font-semibold text-foreground">
            Select character(s) to mark as "{CATEGORY_OPTIONS.find(c => c.id === selectedCategory)?.label}"
          </p>
          {selectedForCategorization.size > 0 && (
            <p className="text-xs text-muted-foreground">{selectedForCategorization.size} selected</p>
          )}
        </div>
      )}

      {/* Section-based organization */}
      <div className="space-y-6 max-h-96 overflow-y-auto">
        {allManageableItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No characters or NPCs</p>
        ) : (() => {
          // Group items by their categorization
          const sections = {
            user: { label: 'You', items: [] },
            active: { label: 'Active Characters', items: [] },
            inactive: { label: 'Inactive Characters', items: [] },
            npc_family: { label: 'Family Members', items: [] },
            npc_fictional: { label: 'People in Their World', items: [] },
            duplicate: { label: 'Duplicates', items: [] },
            delete: { label: 'Delete', items: [] },
            uncategorized: { label: 'Uncategorized', items: [] },
          };

          allManageableItems.forEach((item, index) => {
            const isNPC = item.type === 'world_person' || item.type === 'family';
            const isUser = item.type === 'user';
            const itemData = item.data;
            const npcName = itemData.person_name || itemData.name || `unnamed_${index}`;
            const itemKey = isUser ? 'user' : (isNPC ? `npc_${itemData.source_character_id}_${npcName}_${index}` : itemData.id);

            const category = categorizations.get(itemKey);
            // Skip items marked as duplicates entirely
            if (category === 'duplicate') return;
            
            if (isUser) {
              sections.user.items.push({ item, index, itemKey });
            } else if (category) {
              sections[category].items.push({ item, index, itemKey });
            } else {
              sections.uncategorized.items.push({ item, index, itemKey });
            }
          });

          return Object.entries(sections).map(([sectionKey, section]) => {
            if (section.items.length === 0) return null;
            return (
              <div key={sectionKey} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{section.label}</p>
                {section.items.map(({ item, index, itemKey: itemKeyFromSection }) => {
                  // Handle renaming within mapped context
                  const handleRenameLocal = (charId, oldName, isNpc = false) => {
                    setRenamingId(charId);
                    setNewName(oldName);
                  };
                  const isNPC = item.type === 'world_person' || item.type === 'family';
                  const isUser = item.type === 'user';
                  const itemData = item.data;
                  const npcName = itemData.person_name || itemData.name || `unnamed_${index}`;
                  const mergeEntry = isUser
                    ? { key: 'user', type: 'user', item }
                    : isNPC
                    ? { key: itemKeyFromSection, type: 'npc', sourceCharId: itemData.source_character_id, personName: npcName, item }
                    : { key: itemKeyFromSection, type: 'character', charId: itemData.id, item };
                  const itemName = isUser
                    ? (userSettings.fictional_world_name || itemData.full_name || currentUser?.full_name || 'You')
                    : itemData.name;
                  const isSelected = selectedForMerge.has(itemKeyFromSection);
                  const isCategorizeSelected = selectedForCategorization.has(itemKeyFromSection);
                  const currentCategory = categorizations.get(itemKeyFromSection);
                  const categoryColor = currentCategory ? CATEGORY_OPTIONS.find(c => c.id === currentCategory)?.color : '';

                  return (
                    <motion.div
                       key={`${item.type}-${itemKeyFromSection}`}
                 layout
                 className={`rounded-xl border-2 p-4 transition-all ${
                   categorizationMode
                     ? `cursor-pointer ${isCategorizeSelected ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:border-primary/40'}`
                     : mergeMode
                     ? `cursor-pointer ${isSelected ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:border-primary/40'}`
                     : `bg-card border-border ${categoryColor ? categoryColor : ''}`
                 } ${isUser ? 'ring-2 ring-primary/30' : ''}`}
                 onClick={() => {
                   if (categorizationMode) toggleCategorizeSelection(itemKeyFromSection);
                   if (mergeMode) toggleMergeSelection(mergeEntry);
                 }}
                >
                 <div className="flex items-center gap-3">
                  {(mergeMode || categorizationMode) && (
                     <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                       (isSelected || isCategorizeSelected) ? 'bg-primary border-primary' : 'border-border'
                     }`}>
                       {(isSelected || isCategorizeSelected) && <Check className="w-3 h-3 text-white" />}
                     </div>
                   )}
                  {isUser ? (() => {
                   const userAvatar = itemData.avatar_url
                     || userSettings?.generated_avatar_urls?.[0]
                     || userSettings?.reference_image_urls?.[0]
                     || null;
                   return userAvatar ? (
                     <img src={userAvatar} alt={itemName} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                   ) : (
                     <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
                       <span className="text-sm font-semibold text-primary-foreground">{getInitial(itemName)}</span>
                     </div>
                   );
                  })() : isNPC ? (
                    itemData.avatar_url ? (
                      <img src={itemData.avatar_url} alt={itemName} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-purple-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-white">{getInitial(itemName)}</span>
                      </div>
                    )
                  ) : (
                    <div className="flex-shrink-0">
                      <CharacterAvatar character={itemData} size="md" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                   {renamingId === itemKeyFromSection ? (
                     <div className="flex gap-1">
                       <Input
                         value={newName}
                         onChange={e => setNewName(e.target.value)}
                         className="h-8 text-sm flex-1"
                         autoFocus
                         onKeyDown={e => {
                           if (e.key === 'Enter') submitRename(itemKeyFromSection, isNPC);
                           if (e.key === 'Escape') setRenamingId(null);
                         }}
                       />
                       <Button
                         size="sm"
                         onClick={() => submitRename(itemKeyFromSection, isNPC)}
                         className="h-8 px-2 rounded-lg"
                       >
                         Save
                       </Button>
                     </div>
                   ) : (
                     <>
                       <div className="flex items-center gap-2">
                         <p className="text-base font-semibold text-foreground">
                           {itemName}
                         </p>
                         {isUser && <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">You</span>}
                         {!isUser && !isNPC && itemData.is_active_character && <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium flex items-center gap-1"><Star className="w-3 h-3 fill-primary" /> Active</span>}
                       </div>
                       {isNPC && itemData.appearance_notes && (
                         <p className="text-sm text-muted-foreground">{itemData.appearance_notes}</p>
                       )}
                       {!isUser && !isNPC && (
                         <div className="flex flex-wrap gap-1 mt-0.5">
                           {itemData.character_type && (
                             <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{itemData.character_type}</span>
                           )}
                           {itemData.personality_summary && (
                             <p className="text-xs text-muted-foreground line-clamp-1 w-full">{itemData.personality_summary}</p>
                           )}
                         </div>
                       )}
                     </>
                   )}
                  </div>
                  {!mergeMode && !categorizationMode && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRenameLocal(itemKeyFromSection, itemName, isNPC)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors flex-shrink-0"
                        title="Rename"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!isUser && (
                        <button
                          onClick={() => handleDelete(itemKeyFromSection, isNPC)}
                          className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg transition-colors flex-shrink-0"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                </motion.div>
                );
                })}
                </div>
            );
          }).filter(Boolean);
        })()}
      </div>

      {/* Alert duplicates & ghost NPCs */}
      {(duplicates.length > 0 || ghosts.length > 0) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-700 space-y-1">
          {duplicates.length > 0 && (
            <p><strong>{duplicates.length}</strong> duplicate(s) detected: {duplicates.map(d => d.name).join(', ')}</p>
          )}
          {ghosts.length > 0 && (
            <p><strong>{ghosts.length}</strong> ghost NPC(s) found — these should be merged into active characters</p>
          )}
        </div>
      )}

      {categorizationMode && selectedCategory && (
        <Button
          onClick={handleCategorizeSubmit}
          disabled={selectedForCategorization.size === 0}
          size="sm"
          className="w-full rounded-lg"
        >
          Okay — {selectedForCategorization.size} character(s) as {CATEGORY_OPTIONS.find(c => c.id === selectedCategory)?.label}
        </Button>
      )}

      {categorizationMode && selectedCategory && selectedForCategorization.size === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">Select character(s) above</p>
      )}

      {editable.length > 1 && !mergeMode && !categorizationMode && (
        <Button
          onClick={() => setMergeMode(true)}
          variant="outline"
          size="sm"
          className="w-full rounded-lg gap-2"
        >
          <GitMerge className="w-4 h-4" /> Merge Characters
        </Button>
      )}

      {mergeMode && selectedForMerge.size >= 2 && (
        <Button
          onClick={submitMerge}
          size="sm"
          className="w-full rounded-lg"
        >
          Merge {selectedForMerge.size} Characters
        </Button>
      )}

      {mergeMode && selectedForMerge.size < 2 && (
        <p className="text-xs text-muted-foreground text-center py-2">Select 2+ characters to merge</p>
      )}

      {/* Merge confirmation modal */}
      {mergeConfirmModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setMergeConfirmModal(null)}>
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Who is the REAL person?</h3>
              <p className="text-xs text-muted-foreground">The one you pick is the master. The other(s) are duplicates — they will be permanently erased and replaced everywhere by the master's name and photo.</p>
            </div>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {mergeConfirmModal.selectedItems.map(({ item, entry }) => {
                const isNPC = item.type === 'world_person' || item.type === 'family';
                const isUser = item.type === 'user';
                const itemData = item.data;
                const itemName = isUser
                  ? (userSettings.fictional_world_name || itemData.full_name || currentUser?.full_name || 'You')
                  : itemData.name;
                const avatarUrl = isUser 
                  ? (itemData.avatar_url || userSettings?.generated_avatar_urls?.[0] || userSettings?.reference_image_urls?.[0])
                  : (itemData.avatar_url);

                return (
                  <button
                    key={entry.key}
                    onClick={() => confirmMerge(entry)}
                    className="w-full text-left p-3 rounded-lg border-2 border-border hover:border-emerald-500 hover:bg-emerald-500/5 transition-colors flex gap-3 items-center"
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={itemName} className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className={`w-12 h-12 rounded-full ${isUser ? 'bg-primary' : isNPC ? 'bg-purple-500' : 'bg-secondary'} flex items-center justify-center flex-shrink-0`}>
                        <span className={`text-sm font-semibold ${isUser || isNPC ? 'text-white' : 'text-foreground'}`}>
                          {itemName[0].toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{itemName}</p>
                      <p className="text-xs text-emerald-500 font-medium mt-0.5">✓ This is the real person — keep this one</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-destructive/80 font-medium">
              ⚠ The character(s) you do NOT pick will be permanently deleted and all their appearances replaced by the master.
            </p>
            <Button
              onClick={() => setMergeConfirmModal(null)}
              variant="outline"
              size="sm"
              className="w-full rounded-lg"
            >
              Cancel
            </Button>
          </motion.div>
        </div>,
        document.body
      )}
    </div>
  );
}