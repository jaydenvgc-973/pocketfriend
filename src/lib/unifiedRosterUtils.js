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

  // ── ALL CHARACTERS — deduplicated by canonical ID ──────────────────────
  // Priority order for dedup: active_created_character > npc_family_member > npc_fictitious > npc_regular
  const TYPE_PRIORITY = {
    'active_created_character': 0,
    'active': 0, // legacy alias
    'npc_fictitious': 1,
    'npc_family_member': 2,
    'family_npc': 2, // legacy alias
    'npc_regular': 3,
    'npc': 3, // legacy alias
  };

  // Deduplicate Character entities by normalized name — one record per canonical person
  // This collapses Leo Parker (npc_family_member) if an active_created_character Leo Parker also exists
  const charsByName = new Map(); // normalized name → best Character record
  activeCharacters.forEach(c => {
    if (!c.name?.trim()) return;
    const key = c.name.trim().toLowerCase();
    const existing = charsByName.get(key);
    if (!existing) {
      charsByName.set(key, c);
    } else {
      // Keep the higher-priority type
      const newPriority = TYPE_PRIORITY[c.character_type] ?? 99;
      const existingPriority = TYPE_PRIORITY[existing.character_type] ?? 99;
      if (newPriority < existingPriority) {
        charsByName.set(key, c);
      }
    }
  });

  const dedupedCharacters = Array.from(charsByName.values());

  // Convert deduplicated characters to visual entities
  const allCharsAsEntities = dedupedCharacters.map(c => createVisualEntity(c, 'character'));

  // Separate active and inactive characters
  const activeCharsEntities = allCharsAsEntities.filter(c => c.is_active_character).sort((a, b) => 
    new Date(b.created_date) - new Date(a.created_date)
  );
  const inactiveCharsEntities = allCharsAsEntities.filter(c => !c.is_active_character).sort((a, b) => 
    new Date(b.created_date) - new Date(a.created_date)
  );

  // Build a set of all canonical Character names (for filtering family/world people below)
  const canonicalCharacterNames = new Set(dedupedCharacters.map(c => c.name?.trim().toLowerCase()).filter(Boolean));

  // ── FAMILY MEMBERS ──────────────────────────────────────────────────────
  // Only include family members whose name does NOT already exist as a Character entity.
  // This prevents Leo Parker (Character record) from also appearing as a family_member entry.
  // Deduplicate remaining family members globally by name — one entry per unique person.
  const familyMembersMap = new Map(); // normalized name → first entry wins

  activeCharacters.forEach(char => {
    (char.family_members || []).forEach(fm => {
      // Skip empty/unnamed entries
      if (!fm.name || fm.name.trim() === '' || fm.name.toLowerCase().includes('unnamed')) return;
      // Skip if this person already exists as a Character entity (canonical wins)
      const nameKey = fm.name.trim().toLowerCase();
      if (canonicalCharacterNames.has(nameKey)) return;
      // Deduplicate: first occurrence per name wins (globally across all parent characters)
      if (!familyMembersMap.has(nameKey)) {
        familyMembersMap.set(nameKey, {
          name: fm.name,
          relationship_type: fm.relationship_type || 'Family',
          avatar_url: fm.photo_url || null,
          linked_character_id: fm._linked_character_id || null,
          source_character_id: char.id,
          source_character_name: char.name,
        });
      }
    });
  });

  const familyMembers = Array.from(familyMembersMap.values()).map(member =>
    createVisualEntity({
      // Use stable linked_character_id as the ID if available, else synthesize one
      id: member.linked_character_id || `family_${member.name.toLowerCase().replace(/\s+/g, '_')}`,
      name: member.name,
      avatar_url: member.avatar_url,
      appearance_notes: member.relationship_type,
      source_character_id: member.source_character_id,
      source_character_name: member.source_character_name,
    }, 'family')
  );

  // ── PEOPLE IN THEIR WORLD ────────────────────────────────────────────
  // Only include world people whose name does NOT already exist as a Character entity or family member.
  const worldPeopleMap = new Map(); // Deduplicate by person_name

  activeCharacters.forEach(char => {
    (char.fictional_relationships || []).forEach(rel => {
      if (!rel.person_name) return;
      const nameKey = rel.person_name.toLowerCase();
      // Skip if already a Character entity or a family-only entry
      if (canonicalCharacterNames.has(nameKey)) return;
      if (familyMembersMap.has(nameKey)) return;
      // Only include if there's meaningful NPC data (avatar at minimum)
      if (!rel.related_character_id && rel.avatar_url) {
        if (!worldPeopleMap.has(nameKey)) {
          worldPeopleMap.set(nameKey, {
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
      id: `world_${person.person_name.toLowerCase().replace(/\s+/g, '_')}`,
      name: person.person_name,
      avatar_url: person.avatar_url,
      appearance_notes: `${person.relationship_type}${person.description ? ': ' + person.description : ''}`,
      source_character_id: person.source_character_id,
      source_character_name: person.source_character_name,
    }, 'world_person')
  );

  // ── UNIFIED ROSTER ───────────────────────────────────────────────────────
  // Order: user first, then active characters, then inactive characters, then family-only members, then world people
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