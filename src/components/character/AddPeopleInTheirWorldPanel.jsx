import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function AddPeopleInTheirWorldPanel({ character, onSuccess }) {
  const [mode, setMode] = useState(null); // 'new' | 'existing' | null
  const [newName, setNewName] = useState('');
  const [selectedNPC, setSelectedNPC] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();

  // Get current user for filtering account-associated characters
  const { data: currentUser = null } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
    staleTime: 60000,
  });

  // Fetch all account characters including active characters and NPCs
  const { data: allAccountCharacters = [] } = useQuery({
    queryKey: ['accountCharacters', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const chars = await base44.entities.Character.filter({
        owner_email: currentUser.email
      });
      // Filter out the current character itself and return all others
      return chars.filter(c => c.id !== character.id);
    },
    enabled: !!currentUser?.email
  });

  // Only show canonical npc_fictitious characters (the valid type for People in Their World)
  const accountNPCs = allAccountCharacters.filter(c =>
    c.character_type === 'npc_fictitious' && c.id !== character.id
  );

  // Get NPCs already linked to this character
  const existingNPCIds = new Set(
    (character.fictional_relationships || [])
      .filter(r => r.related_character_id)
      .map(r => r.related_character_id)
  );

  // Filter to only show NPCs not already linked
  const availableNPCs = accountNPCs.filter(npc => !existingNPCIds.has(npc.id));

  const handleAddNew = async () => {
    if (!newName.trim()) return;
    if (!currentUser?.email) {
      alert('Error: Unable to determine current user.');
      return;
    }
    setIsLoading(true);
    try {
      // Create new NPC with canonical type npc_fictitious
      const newNPC = await base44.entities.Character.create({
        name: newName.trim(),
        character_type: 'npc_fictitious',
        owner_email: currentUser.email,
        created_by_role: currentUser.role || 'user',
        owner_user_id: currentUser.id,
        status: 'active',
        exclude_from_homepage: true,
      });

      // Add to fictional_relationships
      const updatedRels = [
        ...(character.fictional_relationships || []),
        {
          person_name: newNPC.name,
          related_character_id: newNPC.id,
          relationship_type: 'friend'
        }
      ];

      await base44.entities.Character.update(character.id, {
        fictional_relationships: updatedRels
      });

      setNewName('');
      setMode(null);
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      if (onSuccess) onSuccess();
    } catch (error) {
      alert('Failed to add person: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddExisting = async () => {
    if (!selectedNPC) return;
    setIsLoading(true);
    try {
      const updatedRels = [
        ...(character.fictional_relationships || []),
        {
          person_name: selectedNPC.name,
          related_character_id: selectedNPC.id,
          relationship_type: 'friend'
        }
      ];

      await base44.entities.Character.update(character.id, {
        fictional_relationships: updatedRels
      });

      setSelectedNPC(null);
      setMode(null);
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      if (onSuccess) onSuccess();
    } catch (error) {
      alert('Failed to add person: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-secondary/30 border border-border rounded-2xl p-4 space-y-3">
      {!mode ? (
        <div className="flex gap-2">
          <button
            onClick={() => setMode('new')}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add New Person
          </button>
          {availableNPCs.length > 0 && (
            <button
              onClick={() => setMode('existing')}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add Existing
            </button>
          )}
        </div>
      ) : mode === 'new' ? (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Type name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddNew()}
            autoFocus
            className="w-full h-10 px-3 rounded-lg bg-background border border-border text-foreground text-sm outline-none focus:ring-1 focus:ring-primary/50"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddNew}
              disabled={!newName.trim() || isLoading}
              className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Adding...' : 'Add'}
            </button>
            <button
              onClick={() => {
                setNewName('');
                setMode(null);
              }}
              className="px-3 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ) : mode === 'existing' ? (
        <div className="space-y-2">
          <select
            value={selectedNPC?.id || ''}
            onChange={(e) => {
              const npc = availableNPCs.find(n => n.id === e.target.value);
              setSelectedNPC(npc || null);
            }}
            autoFocus
            className="w-full h-10 px-3 rounded-lg bg-background border border-border text-foreground text-sm outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">Select a person...</option>
            {availableNPCs.map(npc => (
              <option key={npc.id} value={npc.id}>{npc.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleAddExisting}
              disabled={!selectedNPC || isLoading}
              className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Adding...' : 'Add'}
            </button>
            <button
              onClick={() => {
                setSelectedNPC(null);
                setMode(null);
              }}
              className="px-3 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}