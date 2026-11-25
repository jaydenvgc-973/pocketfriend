import { base44 } from "@/api/base44Client";

/**
 * sceneResponseContext.js — the context a Scene reply is written from.
 *
 * Each established participant contributes two things: their canonical identity and their
 * cross-page memory. Both are fetched here, for everyone, at the same time.
 *
 * They used to be fetched one group after the other — every character's canonical context
 * first, and only then every character's memory — so a reply waited for the slower group
 * before the faster one had even started. Nothing about what the characters receive has
 * changed: the same two calls, with the same arguments, for the same people. They simply
 * overlap now, which is the whole of the delay that was removed here.
 *
 * Context is additive: a call that fails leaves that person's block empty and the scene
 * continues, exactly as before.
 */
export async function loadSceneResponseContext({ cast = [], characters = [], ownerEmail = null }) {
  const ids = [...new Set((cast || []).filter((c) => c && !c.isNpc && c.id).map((c) => c.id))];
  const crossMem = {};
  const canonicalCtx = {};
  if (ids.length === 0) return { crossMem, canonicalCtx };

  await Promise.all(ids.map(async (id) => {
    const charRecord = (characters || []).find((c) => c.id === id);
    await Promise.all([
      base44.functions.invoke("retrieveCrossPageMemory", { characterId: id, limitMessages: 12 })
        .then((r) => { if (r?.data?.contextText) crossMem[id] = r.data.contextText; })
        .catch(() => {}),
      base44.functions.invoke("buildCanonicalCharacterContext", {
        characterId: id,
        interactionContext: "scene",
        ownerEmailHint: charRecord?.owner_email || ownerEmail || null,
      })
        .then((r) => { if (r?.data?.systemPrompt) canonicalCtx[id] = r.data.systemPrompt; })
        .catch(() => {}),
    ]);
  }));

  return { crossMem, canonicalCtx };
}

export default loadSceneResponseContext;