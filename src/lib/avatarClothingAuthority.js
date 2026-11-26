/**
 * avatarClothingAuthority.js — the clothing authority for a person with no outfit on file.
 *
 * A character with no closet outfit, no uniform and no recorded clothing change has not
 * been left blank. Their own avatar and reference photographs ARE their established
 * clothing — including the absence of a garment. A bare torso is visual information, not
 * a gap for the picture to fill with a tank top, undershirt or T-shirt.
 *
 * Selecting an activity (kiss, hug, flirt, bond, sleep, eat, rest, exercise) changes what
 * the person is doing. It is not a clothing change, exactly as it is not a location change.
 *
 * Pure prompt text — no reads, no writes, no side effects.
 */

export function buildNoOutfitClothingAuthority(name) {
  const who = name || 'this person';
  return [
    `CLOTHING (for "${who}" ONLY): No separate outfit is on file for this person — their own avatar and reference photographs ARE their established clothing.`,
    `  ✅ Render exactly what those photographs show: the same garments, colors, layers and footwear — and the same absence of them.`,
    `  ⛔ ABSENCE OF CLOTHING IS INFORMATION: if their avatar shows a bare torso, they are bare-chested in this picture. NEVER add a tank top, undershirt, T-shirt, hoodie, jacket or robe that is not in their own photographs.`,
    `  ⛔ The chosen activity — kissing, hugging, flirting, bonding, sleeping, eating, resting, exercising — is NOT a clothing change. The activity never dresses anyone, and it never dresses them for the setting.`,
    `  ⛔ A previously generated picture that added a garment is a mistake, not established clothing. Never repeat it.`,
    `  ✅ Only a uniform this place genuinely requires, or a real temporary need (a coat in freezing weather, a towel at the shower), may add anything — never an invented shirt.`,
  ].join('\n');
}