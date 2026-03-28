import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { X, Shield, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ProtectedCharactersManager() {
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const queryClient = useQueryClient();

  const { data: userSettings = [] } = useQuery({
    queryKey: ['userSettings'],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters'],
    queryFn: () => base44.entities.Character.list(),
  });

  const settings = userSettings[0];
  const protectedIds = settings?.protected_character_ids || [];
  const protectedCharacters = characters.filter(c => protectedIds.includes(c.id));
  const unprotectedCharacters = characters.filter(c => !protectedIds.includes(c.id));

  const addProtectionMutation = useMutation({
    mutationFn: async (characterId) => {
      if (!settings) return;
      const updated = [...protectedIds, characterId];
      await base44.entities.UserSettings.update(settings.id, {
        protected_character_ids: updated
      });
      
      // Trigger behavior for protected character (e.g., Ethan)
      const char = characters.find(c => c.id === characterId);
      if (char?.name === 'Ethan') {
        // Archive existing messages with higher retention (protected rule)
        const convos = await base44.entities.Conversation.filter(
          { type: 'direct', character_ids: [characterId] },
          "-updated_date"
        );
        if (convos?.length > 0) {
          for (const convo of convos) {
            base44.functions.invoke('archiveOldMessages', { 
              conversationId: convo.id, 
              keepRecent: 100  // Protected: keep more messages
            }).catch(() => {});
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userSettings'] });
      setSelectedCharacter(null);
    },
  });

  const removeProtectionMutation = useMutation({
    mutationFn: async (characterId) => {
      if (!settings) return;
      const updated = protectedIds.filter(id => id !== characterId);
      await base44.entities.UserSettings.update(settings.id, {
        protected_character_ids: updated
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userSettings'] });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-primary" />
          Protected Characters
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Protected characters receive default-like priority: stronger message persistence, memory continuity, and thread stability on your account only.
        </p>

        <AnimatePresence>
          {protectedCharacters.length > 0 ? (
            <div className="space-y-2 mb-4">
              {protectedCharacters.map((char) => (
                <motion.div
                  key={char.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20"
                >
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-foreground">{char.name}</span>
                  </div>
                  <button
                    onClick={() => removeProtectionMutation.mutate(char.id)}
                    disabled={removeProtectionMutation.isPending}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-secondary/50 border border-border text-xs text-muted-foreground">
              No protected characters yet. Add one below.
            </div>
          )}
        </AnimatePresence>
      </div>

      {unprotectedCharacters.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
            Add Protection
          </h4>
          <div className="space-y-2">
            {unprotectedCharacters.map((char) => (
              <motion.button
                key={char.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => addProtectionMutation.mutate(char.id)}
                disabled={addProtectionMutation.isPending}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-secondary border border-border hover:border-primary/50 transition-all text-left text-sm"
              >
                <span className="text-foreground font-medium">{char.name}</span>
                <Plus className="w-4 h-4 text-muted-foreground" />
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}