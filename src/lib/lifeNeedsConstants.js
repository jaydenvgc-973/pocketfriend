/**
 * Shared Life Needs display constants.
 *
 * Single definition of the needs metadata (label, entity key, emoji) and the
 * value→label/color mapping. Both CharacterNeedsPanel (Character Profile) and
 * LifeNeedsPopover (Chat / Text header) import from here so the display is
 * identical everywhere.
 *
 * The VALUES are never stored or calculated here — they come from the canonical
 * Character entity fields (character[key]). This file is display metadata only.
 */

export const LIFE_NEEDS = [
  { label: 'Hunger',      key: 'hunger_value',         emoji: '🍽️', description: 'How hungry they are' },
  { label: 'Energy',      key: 'energy_value',          emoji: '⚡',  description: 'Physical energy level' },
  { label: 'Social Need', key: 'social_value',          emoji: '👥', description: 'How fulfilled their need for interpersonal connection is' },
  { label: 'Health',      key: 'health_value',          emoji: '❤️', description: 'Physical health status' },
  { label: 'Mental',      key: 'mental_value',          emoji: '🧠', description: 'Mental wellbeing' },
  { label: 'Financial',   key: 'financial_need_value', emoji: '💰', description: 'Financial stability' },
  { label: 'Hygiene',     key: 'hygiene_value',         emoji: '🚿', description: 'Personal hygiene' },
  { label: 'Comfort',     key: 'comfort_value',        emoji: '🛋️', description: 'Comfort and ease' },
];

export function getLifeNeedLabel(value) {
  if (value >= 76) return { text: 'Strong',   color: 'text-green-500',  bg: 'bg-green-600' };
  if (value >= 51) return { text: 'Stable',   color: 'text-blue-400',   bg: 'bg-blue-500' };
  if (value >= 26) return { text: 'Low',      color: 'text-amber-500',  bg: 'bg-amber-500' };
  return               { text: 'Critical', color: 'text-destructive', bg: 'bg-destructive' };
}