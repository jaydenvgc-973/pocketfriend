/**
 * Unified roster system for all visual identities in the app
 * Includes: user, active characters, family members, and People In Their World as first-class visual entities
 */

/**
 * Generate avatar placeholder (purple circle with initial)
 */
export function getPlaceholderColor(name) {
  return 'bg-purple-500';
}

/**
 * Get initials from a name
 */
export function getInitial(name) {
  return name?.[0]?.toUpperCase() || '?';
}

/**
 * Create a visual entity object for any person (user, character, family member, or world person)
 */
export function createVisualEntity(data, entityType) {
  return {
    id: data.id || `${entityType}_${Math.random()}`,
    name: data.name || data.person_name || 'Unknown',
    avatar_url: data.avatar_url || null,
    entity_type: entityType, // 'user' | 'character' | 'family' | 'world_person'
    is_user: entityType === 'user',
    is_character: entityType === 'character',
    is_family: entityType === 'family',
    is_world_person: entityType === 'world_person',
    // Appearance data for generation reference
    appearance_notes: data.appearance_notes || '',
    age_range: data.age_range || '',
    gender: data.gender || '',
    ethnicities: data.ethnicities || [],
    // For world people and family, store parent character info
    source_character_id: data.source_character_id || null,
    source_character_name: data.source_character_name || null,
  };
}

/**
 * Fetch unified roster: user + all characters + family members + People In Their World
 * Each person is a first-class visual entity with avatar handling
 */
export async function fetchUnifiedRoster(base44, userEmail) {
  if (!userEmail) return [];

  const [user, settingsList, all] = await Promise.all([
    base44.auth.me().catch(() => null),
    base44.entities.UserSettings.list().catch(() => []),
    base44.entities.Character.filter({ created_by: userEmail }).catch(() => []),
  ]);

  const settings = settingsList?.[0] || {};
  const activeCharacters = all.filter(c => c.status !== 'deleted');

  // ── USER ENTITY ──────────────────────────────────────────────────────────
  let userAvatarUrl = null;
  if (user?.avatar_url) {
    userAvatarUrl = user.avatar_url;
  } else if (settings?.generated_avatar_urls?.[0]) {
    userAvatarUrl = settings.generated_avatar_urls[0];
  } else if (user?.reference_image_urls?.[0]) {
    userAvatarUrl = user.reference_image_urls[0];
  }

  const userEntity = user ? createVisualEntity({
    id: 'user',
    name: user.full_name || 'You',
    avatar_url: userAvatarUrl,
    appearance_notes: user.appearance_notes || '',
    age_range: user.age_range || '',
    gender: user.gender || '',
    ethnicities: user.ethnicities || [],
    reference_image_urls: user.reference_image_urls || [],
    generated_avatar_urls: user.generated_avatar_urls || [],
  }, 'user') : null;

  // ── ALL CHARACTERS ──────────────────────────────────────────────────
  const allChars = activeCharacters
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
    .map(c => createVisualEntity(c, 'character'));

  // ── FAMILY MEMBERS ──────────────────────────────────────────────────────
  // Collect family members from all active characters
  const familyMembersMap = new Map(); // Deduplicate by name + source character

  activeCharacters.forEach(char => {
    (char.family_members || []).forEach(fm => {
      if (fm.name) {
        const key = `${fm.name.toLowerCase()}_${char.id}`;
        if (!familyMembersMap.has(key)) {
          familyMembersMap.set(key, {
            name: fm.name,
            relationship_type: fm.relationship_type || 'Family',
            avatar_url: fm.photo_url || null,
            source_character_id: char.id,
            source_character_name: char.name,
          });
        }
      }
    });
  });

  const familyMembers = Array.from(familyMembersMap.values()).map(member =>
    createVisualEntity({
      id: `family_${member.source_character_id}_${member.name.replace(/\s+/g, '_')}`,
      name: member.name,
      avatar_url: member.avatar_url,
      appearance_notes: member.relationship_type,
      source_character_id: member.source_character_id,
      source_character_name: member.source_character_name,
    }, 'family')
  );

  // ── PEOPLE IN THEIR WORLD ────────────────────────────────────────────
  // Collect all world people from all active characters' fictional_relationships
  const worldPeopleMap = new Map(); // Deduplicate by person_name

  activeCharacters.forEach(char => {
    (char.fictional_relationships || []).forEach(rel => {
      if (rel.person_name && !rel.related_character_id) {
        // This is an NPC/world person, not a link to another character
        const key = rel.person_name.toLowerCase();
        if (!worldPeopleMap.has(key)) {
          worldPeopleMap.set(key, {
            person_name: rel.person_name,
            relationship_type: rel.relationship_type,
            description: rel.description,
            avatar_url: rel.character_id ? null : null, // Will check for stored avatar
            source_character_id: char.id,
            source_character_name: char.name,
          });
        }
      }
    });
  });

  const worldPeople = Array.from(worldPeopleMap.values()).map(person =>
    createVisualEntity({
      id: `world_${person.source_character_id}_${person.person_name.replace(/\s+/g, '_')}`,
      name: person.person_name,
      avatar_url: person.avatar_url,
      appearance_notes: `${person.relationship_type}${person.description ? ': ' + person.description : ''}`,
      source_character_id: person.source_character_id,
      source_character_name: person.source_character_name,
    }, 'world_person')
  );

  // ── UNIFIED ROSTER ───────────────────────────────────────────────────────
  // Order: user first, then all characters, then family members, then world people
  const roster = [
    ...(userEntity ? [userEntity] : []),
    ...allChars,
    ...familyMembers,
    ...worldPeople,
  ];

  return roster;
}

/**
 * For backward compatibility, also export function that builds just characters + user
 * (used in some existing code)
 */
export async function fetchCharacterListForPicker(base44, userEmail) {
  const roster = await fetchUnifiedRoster(base44, userEmail);
  // Filter to just user and characters (not world people or family) for places that don't need them
  return roster.filter(e => e.entity_type === 'user' || e.entity_type === 'character');
}