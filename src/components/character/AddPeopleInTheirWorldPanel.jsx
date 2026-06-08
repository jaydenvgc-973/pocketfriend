import React, { useState } from 'react';
import { Plus, X, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function AddPeopleInTheirWorldPanel({ character, onSuccess }) {
  const [mode, setMode] = useState(null); // 'new' | 'existing' | null
  const [newName, setNewName] = useState('');
  const [selectedNPC, setSelectedNPC] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const queryClient = useQueryClient();

  // Get current user
  const { data: currentUser = null } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
    staleTime: 60000,
  });

  // Fetch all account characters + world-service NPCs (e.g. Vick Servicio)
  // owner_email filter alone misses npc_world_service characters — fetch both sources.
  const { data: allAccountCharacters = [] } = useQuery({
    queryKey: ['accountCharactersForRelationship', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const [owned, npcRes] = await Promise.all([
        base44.entities.Character.filter({ owner_email: currentUser.email }).catch(() => []),
        base44.functions.invoke('fetchNPCsForUser', {}).catch(() => ({ data: { npcs: [] } })),
      ]);
      const npcs = npcRes?.data?.npcs || [];
      // Merge, deduplicate by id
      const seen = new Set();
      return [...owned, ...npcs].filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return c.id !== character.id;
      });
    },
    enabled: !!currentUser?.email
  });

  // Show all account characters that can be known people — includes npc_fictitious,
  // npc_world_service (e.g. Vick Servicio), active_created_character, and npc_regular.
  // npc_world_service must NOT be excluded — characters must be able to know Vick.
  const RELATIONSHIP_ELIGIBLE_TYPES = new Set([
    'npc_fictitious',
    'npc_world_service',
    'active_created_character',
    'npc_regular',
    'npc_family_member',
  ]);
  const accountNPCs = allAccountCharacters.filter(c =>
    RELATIONSHIP_ELIGIBLE_TYPES.has(c.character_type) && c.id !== character.id
  );

  // NPCs already linked to this character
  const existingNPCIds = new Set(
    (character.fictional_relationships || [])
      .filter(r => r.related_character_id)
      .map(r => r.related_character_id)
  );

  // Available NPCs not yet linked, sorted A→Z
  const availableNPCs = accountNPCs
    .filter(npc => !existingNPCIds.has(npc.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const handleAddNew = async () => {
    if (!newName.trim()) return;
    setErrorMsg(null);

    // ── GUARD: Owner context is mandatory — fail visibly if missing ───────────
    if (!currentUser?.email || !currentUser?.id) {
      setErrorMsg('You must be logged in to add people to this character\'s world. Please refresh and try again.');
      console.error('[AddPeopleInTheirWorldPanel] BLOCKED — missing currentUser context:', {
        emailPresent: !!currentUser?.email,
        idPresent: !!currentUser?.id,
      });
      return;
    }

    setIsLoading(true);
    try {
      // Route through the existing working path: createCharacterWithRelationships
      const createRes = await base44.functions.invoke('createCharacterWithRelationships', {
        characterData: {
          name: newName,
          character_type: 'npc_fictitious',
          owner_email: currentUser.email,
          owner_user_id: currentUser.id,
          created_by_role: currentUser.role || 'user',
          status: 'active',
          exclude_from_homepage: true,
        },
        characterRelationships: [],
      });

      if (!createRes.data?.success) {
        throw new Error(createRes.data?.error || 'Failed to create character');
      }

      const newNPC = createRes.data.character;

      // ── RELATIONSHIP UPDATE: re-fetch current state before writing ──────────
      // Prevents stale props from overwriting newer data saved since last render.
      const freshChar = await base44.entities.Character.filter({ id: character.id }).catch(() => []);
      const currentRels = (freshChar[0]?.fictional_relationships || character.fictional_relationships || [])
        .map(r => { const { fictional_relationships: _fr, family_members: _fm, memories: _m, ...safe } = r; return safe; });
      const updatedRels = [
        ...currentRels,
        {
          person_name: newNPC.name,
          related_character_id: newNPC.id,
          relationship_type: 'acquaintance',
          friendship_level: 30,
          user_respect_level: 50,
          romantic_level: 0,
          attraction_level: 0,
          chosen_family_level: 0,
          description: '',
          current_status: '',
          last_interaction_summary: '',
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
      setErrorMsg('Failed to add person: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddExisting = async () => {
    if (!selectedNPC) return;
    setErrorMsg(null);
    setIsLoading(true);
    try {
      // ── SAFE MINIMAL ENTRY ─────────────────────────────────────────────────
      // CRITICAL: Never embed full Character objects in fictional_relationships.
      // Store only minimal safe fields to prevent profile crashes and render loops.
      const safeRelEntry = {
        person_name: selectedNPC.name,
        related_character_id: selectedNPC.id,
        relationship_type: 'acquaintance',
        friendship_level: 30,
        user_respect_level: 50,
        romantic_level: 0,
        attraction_level: 0,
        chosen_family_level: 0,
        description: '',
        current_status: '',
        last_interaction_summary: '',
      };

      // ── FRESH READ → MERGE → WRITE: Character A side ───────────────────────
      // Always re-fetch before writing to prevent stale-array overwrites.
      const freshCharArr = await base44.entities.Character.filter({ id: character.id }).catch(() => []);
      const currentRels = (freshCharArr[0]?.fictional_relationships || character.fictional_relationships || [])
        // Safety: strip any accidentally embedded full objects (no fictional_relationships key allowed inside)
        .map(r => {
          const { fictional_relationships: _fr, family_members: _fm, memories: _m, ...safe } = r;
          return safe;
        });

      // Guard: don't add duplicate
      const alreadyLinked = currentRels.some(r => r.related_character_id === selectedNPC.id);
      if (!alreadyLinked) {
        await base44.entities.Character.update(character.id, {
          fictional_relationships: [...currentRels, safeRelEntry],
        });
      }

      // ── BILATERAL WRITE: Other side (B → A) ─────────────────────────────────
      // For npc_world_service (Vick) and npc_fictitious characters, write a reciprocal
      // entry so both sides know each other. Uses fresh read to avoid stale overwrites.
      const isLinkedChar = selectedNPC.character_type === 'npc_world_service'
        || selectedNPC.is_world_service === true
        || selectedNPC.character_type === 'active_created_character'
        || selectedNPC.character_type === 'npc_fictitious'
        || selectedNPC.character_type === 'npc_regular';

      if (isLinkedChar && !alreadyLinked) {
        base44.entities.Character.filter({ id: selectedNPC.id }).then(arr => {
          const target = arr[0];
          if (!target) return;
          const targetRels = (target.fictional_relationships || [])
            .map(r => {
              const { fictional_relationships: _fr, family_members: _fm, memories: _m, ...safe } = r;
              return safe;
            });
          const alreadyHasUs = targetRels.some(r => r.related_character_id === character.id);
          if (!alreadyHasUs) {
            const reciprocalEntry = {
              person_name: character.name,
              related_character_id: character.id,
              relationship_type: 'known contact',
              friendship_level: 30,
              user_respect_level: 50,
              romantic_level: 0,
              attraction_level: 0,
              chosen_family_level: 0,
              description: '',
              current_status: '',
              last_interaction_summary: '',
            };
            base44.entities.Character.update(selectedNPC.id, {
              fictional_relationships: [...targetRels, reciprocalEntry],
            }).catch(e => console.warn('[AddPeopleInTheirWorldPanel] Bilateral write failed (non-fatal):', e.message));
          }
        }).catch(() => {});
      }

      setSelectedNPC(null);
      setMode(null);
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      if (onSuccess) onSuccess();
    } catch (error) {
      setErrorMsg('Failed to add person: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-secondary/30 border border-border rounded-2xl p-4 space-y-3">
      {/* Visible error banner */}
      {errorMsg && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{errorMsg}</p>
        </div>
      )}

      {!mode ? (
        <div className="flex gap-2">
          <button
            onClick={() => { setMode('new'); setErrorMsg(null); }}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add New Person
          </button>
          {availableNPCs.length > 0 && (
            <button
              onClick={() => { setMode('existing'); setErrorMsg(null); }}
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
              onClick={() => { setNewName(''); setMode(null); setErrorMsg(null); }}
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
              onClick={() => { setSelectedNPC(null); setMode(null); setErrorMsg(null); }}
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