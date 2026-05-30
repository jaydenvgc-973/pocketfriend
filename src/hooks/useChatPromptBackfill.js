import { useEffect } from "react";
import { base44 } from "@/api/base44Client";

/**
 * useChatPromptBackfill
 *
 * Chat/Text-owned hook. Runs only when Chat opens for a character that has no
 * stored system_prompt_url. Builds the prompt client-side (pure string — no AI
 * call, no InvokeLLM) and uploads it once to get a stable URL, then writes that
 * URL back to the Character record and patches the query cache surgically.
 *
 * PRIORITY RULES:
 * - Never runs on Home, App.jsx, or any global provider.
 * - Never calls InvokeLLM, GenerateImage, or any AI endpoint.
 * - Fires only when the Chat page is active and character.system_prompt_url is absent.
 * - Per-character per-session gate (sessionStorage) prevents repeated uploads on remount.
 * - Does NOT block the chat response path — Chat already has a full inline fallback
 *   at sendMessage time (buildSystemPrompt) for characters without a stored URL.
 *   This hook simply improves subsequent sends by storing the URL once.
 *
 * If the existing Chat inline fallback (buildSystemPrompt in sendMessage) fully
 * satisfies the response for a character without system_prompt_url, this hook
 * is an optimization only. It does not gate or block any response.
 */
export function useChatPromptBackfill({ character, characterId, currentUser, queryClient }) {
  useEffect(() => {
    if (!character || !characterId || !currentUser?.email) return;
    // Already has a stored URL — nothing to do
    if (character.system_prompt_url) return;
    // Per-character per-session gate — prevents repeated uploads on re-mount
    const backfillKey = `prompt_backfill_done_${characterId}`;
    if (sessionStorage.getItem(backfillKey)) return;
    sessionStorage.setItem(backfillKey, '1');

    // Defer 3s so this does NOT compete with the initial conversation load
    const timer = setTimeout(() => {
      import('@/lib/defaultCharacter').then(({ DEFAULT_CHARACTER_DATA, buildSystemPrompt }) => {
        const charData = {
          ...DEFAULT_CHARACTER_DATA,
          name: character.name,
          avatar_url: character.avatar_url || undefined,
          reference_image_urls: character.reference_image_urls || undefined,
          emotional_state: character.emotional_state || "calm",
        };
        const promptText = buildSystemPrompt(null, charData, { allowNarration: false });

        base44.integrations.Core.UploadFile({
          file: new File([promptText], "system_prompt.txt", { type: "text/plain" })
        }).then(({ file_url }) => {
          // Write URL to Character record — only the url field, no other overwrites
          return base44.entities.Character.update(characterId, { system_prompt_url: file_url })
            .then(() => {
              // Surgical cache patch — do NOT invalidate full character list
              if (currentUser?.email) {
                queryClient.setQueryData(["characters", currentUser.email], (prev) => {
                  if (!Array.isArray(prev)) return prev;
                  return prev.map(c =>
                    c.id === characterId ? { ...c, system_prompt_url: file_url } : c
                  );
                });
              }
              queryClient.setQueryData(["character", characterId], (prev) =>
                prev ? { ...prev, system_prompt_url: file_url } : prev
              );
              console.log(`[useChatPromptBackfill] Stored system_prompt_url for character=${character.name}`);
            });
        }).catch((err) => {
          // Non-critical — Chat inline fallback handles missing URL on every send
          console.warn(`[useChatPromptBackfill] Upload failed for ${character.name}: ${err?.message}`);
        });
      }).catch(() => {});
    }, 3000);

    return () => clearTimeout(timer);
  }, [character?.id, character?.system_prompt_url]); // eslint-disable-line react-hooks/exhaustive-deps
}