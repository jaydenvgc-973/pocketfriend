/**
 * Test: Confirms Khalil's current_outfit is correctly resolved and built
 * by the same logic as generateImageAsync.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function buildOutfitText(outfit) {
  if (!outfit) return null;
  const rawParts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories].filter(Boolean);
  const parts = rawParts.map(p => {
    const trimmed = p.trim();
    if (/^n\/?a$/i.test(trimmed)) return null;
    if (/^none$/i.test(trimmed)) return null;
    if (/^-$/i.test(trimmed)) return null;
    return trimmed;
  }).filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  if (outfit.full_description) return outfit.full_description.trim();
  return null;
}

function resolveCharacterOutfitForPrompt(character) {
  if (!character) return null;
  const currentOutfit = character.current_outfit;
  if (currentOutfit?.outfit_id || currentOutfit?.label) {
    const text = buildOutfitText(currentOutfit);
    if (text) return { source: 'current_outfit', outfit: currentOutfit, text };
  }
  const closet = character.character_closet || [];
  const outfits = closet.filter(item => item.outfit_id);
  if (outfits.length === 0) return null;
  return { source: 'closet_rotation', outfit: outfits[0], text: buildOutfitText(outfits[0]) };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const all = await base44.entities.Character.list('-updated_date', 200);
  const khalil = all.find(c => c.name && c.name.toLowerCase().includes('khalil'));
  if (!khalil) return Response.json({ error: 'Khalil not found', count: all.length });

  const resolved = resolveCharacterOutfitForPrompt(khalil);
  const outfitText = resolved?.text || null;

  // Build charDesc exactly as generateImageAsync does
  const parts = [
    khalil.age_range ? `${khalil.age_range} years old` : null,
    khalil.gender,
    khalil.ethnicities?.length > 0 ? khalil.ethnicities.join('/') + ' ethnicity' : null,
    khalil.appearance_lock?.skin_tone ? `${khalil.appearance_lock.skin_tone} skin tone` : null,
    khalil.appearance_lock?.hairstyle ? `${khalil.appearance_lock.hairstyle} hairstyle` : null,
    khalil.appearance_lock?.hair_type ? `${khalil.appearance_lock.hair_type} hair` : null,
    khalil.appearance_lock?.facial_hair ? `${khalil.appearance_lock.facial_hair}` : null,
    khalil.appearance_notes || null,
    khalil.avatar_description_text || null,
  ].filter(Boolean);
  let charDesc = parts.join(', ');
  if (outfitText) {
    charDesc = charDesc ? `${charDesc}. Currently wearing: ${outfitText}` : `Currently wearing: ${outfitText}`;
  }

  // Build closet lock text exactly as buildPrompt does
  const charOutfitText = (charDesc || '').match(/Currently wearing:\s*(.+)/)?.[1]?.split('. Currently wearing:')[0]?.trim() || null;
  const hasBottoms = charOutfitText && /sweatpants|pants|jeans|shorts|joggers|leggings|trousers/i.test(charOutfitText);
  const hasShoes = charOutfitText && /sneakers|shoes|boots|sandals|loafers|heels/i.test(charOutfitText);
  const isShirtless = charOutfitText && /shirtless|no top|no shirt/i.test(charOutfitText);

  return Response.json({
    PASS: !!outfitText,
    character_id: khalil.id,
    character_name: khalil.name,
    current_outfit_raw: khalil.current_outfit,
    resolved_outfit_source: resolved?.source,
    outfit_text_built: outfitText,
    charDesc_final: charDesc,
    closet_lock_outfit_text: charOutfitText,
    closet_lock_flags: { isShirtless, hasBottoms, hasShoes },
    closet_lock_preview: charOutfitText
      ? `🔒 CLOSET OUTFIT LOCK — CANONICAL LAW\n${khalil.name} OUTFIT (MANDATORY): "${charOutfitText}"\n${isShirtless ? '✅ SHIRTLESS — bare torso, NO shirt.\n' : ''}${hasBottoms ? '✅ BOTTOMS REQUIRED IN FRAME\n' : ''}${hasShoes ? '✅ SHOES REQUIRED IN FRAME — full/3/4 body shot mandatory\n' : ''}⛔ Shirt on shirtless = FAIL. ⛔ Wrong pants = FAIL. ⛔ Shoes cropped = FAIL.`
      : 'NO CLOSET LOCK — outfit not resolved',
  });
});