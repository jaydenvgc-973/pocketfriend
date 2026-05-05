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
    is_active_character: data.is_active_character || false,
    character_type: data.character_type || (entityType === 'character' ? 'active' : null), // 'active' | 'npc' | 'family_npc' | etc.
    status: data.status || null,
    created_date: data.created_date || null,
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

  const ADMIN_EMAIL = 'murqart@gmail.com';
  const isAdmin = userEmail === ADMIN_EMAIL;

  const [user, settingsList, all] = await Promise.all([
    base44.auth.me().catch(() => null),
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    base44.entities.UserSettings.filter({ owner_email: userEmail }).catch(() => []),
    isAdmin
      ? base44.entities.Character.list('-created_date', 200).catch(() => [])
      : base44.entities.Character.filter({ owner_email: userEmail }, '-created_date', 200).catch(() => []),
  ]);

  const settings = Array.isArray(settingsList) ? settingsList[0] : settingsList || {};
  const activeCharacters = all.filter(c => c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged');

  // ── USER ENTITY ──────────────────────────────────────────────────────────
  let userAvatarUrl = null;
  if (user?.avatar_url) {
    userAvatarUrl = user.avatar_url;
  } else if (settings?.generated_avatar_urls?.[0]) {
    userAvatarUrl = settings.generated_avatar_urls[0];
  } else if (user?.reference_image_urls?.[0]) {
    userAvatarUrl = user.reference_image_urls[0];
  }

  // Prefer generated avatars first, then reference images for display
  const userDisplayAvatar = user?.generated_avatar_urls?.[0]
    || settings?.generated_avatar_urls?.[0]
    || user?.reference_image_urls?.[0]
    || settings?.reference_image_urls?.[0]
    || null;

  // The authoritative in-world name for the user — MUST use fictional_world_name if set
  const userWorldName = settings?.fictional_world_name || user?.full_name || 'You';

  // All reference images for generation — generated first (stronger identity signal), then raw uploads
  const userReferenceImages = [
    ...(user?.generated_avatar_urls || []),
    ...(settings?.generated_avatar_urls || []),
    ...(user?.reference_image_urls || []),
    ...(settings?.reference_image_urls || []),
  ].filter((v, i, a) => v && a.indexOf(v) === i); // dedupe

  const userEntity = user ? {
    ...createVisualEntity({
      id: 'user',
      name: userWorldName,
      avatar_url: userDisplayAvatar,
      appearance_notes: user.appearance_notes || settings?.appearance_notes || '',
      age_range: user.age_range || settings?.user_age_range || '',
      gender: user.gender || settings?.user_gender || '',
      ethnicities: user.ethnicities || [],
      reference_image_urls: userReferenceImages,
      generated_avatar_urls: user?.generated_avatar_urls || settings?.generated_avatar_urls || [],
    }, 'user'),
    // Expose world name separately for consumers that need it
    world_name: userWorldName,
    // Full reference image list for image generation
    all_reference_images: userReferenceImages,
  } : null;

  // ── ALL CHARACTERS ──────────────────────────────────────────────────
  // Convert all characters to visual entities first, preserving is_active_character flag
  const allCharsAsEntities = activeCharacters.map(c => createVisualEntity(c, 'character'));

  // Separate active and inactive characters
  const activeCharsEntities = allCharsAsEntities.filter(c => c.is_active_character).sort((a, b) => 
    new Date(b.created_date) - new Date(a.created_date)
  );
  const inactiveCharsEntities = allCharsAsEntities.filter(c => !c.is_active_character).sort((a, b) => 
    new Date(b.created_date) - new Date(a.created_date)
  );

  // ── FAMILY MEMBERS ──────────────────────────────────────────────────────
  // Collect family members from all active characters
  // Deduplicate: same name + source character = same family member, keep only one
  const familyMembersMap = new Map();

  activeCharacters.forEach(char => {
    (char.family_members || []).forEach(fm => {
      // Skip empty/unnamed entries (ghosts)
      if (!fm.name || fm.name.trim() === '' || fm.name.toLowerCase().includes('unnamed')) {
        return;
      }
      const key = `${fm.name.toLowerCase()}_${char.id}`;
      // Only keep the first instance; later duplicates are ignored
      if (!familyMembersMap.has(key)) {
        familyMembersMap.set(key, {
          name: fm.name,
          relationship_type: fm.relationship_type || 'Family',
          avatar_url: fm.photo_url || null,
          source_character_id: char.id,
          source_character_name: char.name,
        });
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
  // Collect actual NPCs (with fictional_relationships records that have deeper metadata beyond just status).
  // Pure relationship status objects (just person_name + relationship metadata) are NOT separate entities.
  const worldPeopleMap = new Map(); // Deduplicate by person_name

  activeCharacters.forEach(char => {
    (char.fictional_relationships || []).forEach(rel => {
      // Only include if there's meaningful NPC data beyond a status entry:
      // Must have avatar_url, appearance notes, or other distinct identity markers
      if (rel.person_name && !rel.related_character_id && rel.avatar_url) {
        const key = rel.person_name.toLowerCase();
        if (!worldPeopleMap.has(key)) {
          worldPeopleMap.set(key, {
            person_name: rel.person_name,
            relationship_type: rel.relationship_type,
            description: rel.description,
            avatar_url: rel.avatar_url,
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
  // Order: user first, then active characters (by creation date desc), then inactive characters (by creation date desc), then family members, then world people
  const roster = [
    ...(userEntity ? [userEntity] : []),
    ...activeCharsEntities,
    ...inactiveCharsEntities,
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