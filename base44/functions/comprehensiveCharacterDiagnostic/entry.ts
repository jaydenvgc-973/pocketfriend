import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.list();
    const userSettings = await base44.entities.UserSettings.list();
    const settings = userSettings[0] || {};
    const displayName = settings.fictional_world_name || user?.full_name || 'User';

    const findings = {
      timestamp: new Date().toISOString(),
      worldName: displayName,
      activeCharacters: characters.filter(c => c.status === 'active').length,
      totalCharacters: characters.length,
      issues: {
        duplicateNames: [],
        npcMatchingActiveChar: [],
        incorrectFamilyReferences: [],
        ghostNPCs: [],
        worldNameInconsistencies: [],
        crossReferenceErrors: [],
      },
      summary: '',
    };

    // ─ PASS 1: Find duplicate names (same normalized name, multiple records) ─
    const nameMap = new Map();
    characters.forEach(c => {
      const normalized = (c.name || '').toLowerCase().trim();
      if (!nameMap.has(normalized)) nameMap.set(normalized, []);
      nameMap.get(normalized).push(c);
    });

    nameMap.forEach((chars, normalized) => {
      if (chars.length > 1) {
        findings.issues.duplicateNames.push({
          name: normalized,
          count: chars.length,
          records: chars.map(c => ({
            id: c.id,
            displayName: c.name,
            type: c.character_type,
            status: c.status,
            createdDate: c.created_date,
            isActive: c.is_active_character,
            createdBy: c.created_by,
          })),
        });
      }
    });

    // ─ PASS 2: Find NPCs with same name as active characters ─
    const activeCharNames = new Set(characters.filter(c => c.status === 'active').map(c => (c.name || '').toLowerCase().trim()));
    characters.forEach(c => {
      if ((c.character_type === 'npc' || c.character_type === 'family_npc' || c.character_type === 'promoted_npc') && 
          activeCharNames.has((c.name || '').toLowerCase().trim())) {
        findings.issues.npcMatchingActiveChar.push({
          npcId: c.id,
          npcName: c.name,
          npcType: c.character_type,
          matchingActiveChar: characters.find(x => x.status === 'active' && (x.name || '').toLowerCase().trim() === (c.name || '').toLowerCase().trim()),
        });
      }
    });

    // ─ PASS 3: Check for incorrect family references ─
    characters.forEach(char => {
      if (!char.family_members) return;
      char.family_members.forEach((fam, idx) => {
        if (!fam.name) return;
        // Check if this family member name matches an active character
        const matchingActive = characters.find(c => c.status === 'active' && (c.name || '').toLowerCase().trim() === (fam.name || '').toLowerCase().trim());
        if (matchingActive) {
          findings.issues.incorrectFamilyReferences.push({
            charId: char.id,
            charName: char.name,
            familyMemberName: fam.name,
            familyMemberAge: fam.age_at_creation,
            shouldLinkToCharId: matchingActive.id,
            shouldLinkToCharName: matchingActive.name,
          });
        }
      });
    });

    // ─ PASS 4: Find ghost NPCs (NPCs with no relationships, no character ownership, not listed anywhere) ─
    const referencedNPCNames = new Set();
    characters.forEach(char => {
      (char.fictional_relationships || []).forEach(rel => {
        if (!rel.related_character_id && rel.person_name) {
          referencedNPCNames.add((rel.person_name || '').toLowerCase().trim());
        }
      });
      (char.family_members || []).forEach(fm => {
        if (fm.name) referencedNPCNames.add((fm.name || '').toLowerCase().trim());
      });
    });

    characters.forEach(char => {
      if ((char.character_type === 'npc' || char.character_type === 'family_npc' || char.character_type === 'promoted_npc') &&
          !referencedNPCNames.has((char.name || '').toLowerCase().trim())) {
        findings.issues.ghostNPCs.push({
          id: char.id,
          name: char.name,
          type: char.character_type,
          createdDate: char.created_date,
          createdBy: char.created_by,
        });
      }
    });

    // ─ PASS 5: World name inconsistencies (characters created before/after world name was set) ─
    const beforeWorldName = characters.filter(c => c.created_by === user.email && !c.created_date || new Date(c.created_date) < new Date(settings.created_date || '2025-01-01'));
    if (beforeWorldName.length > 0) {
      findings.issues.worldNameInconsistencies.push({
        issue: 'Characters created before world name was set',
        count: beforeWorldName.length,
        characters: beforeWorldName.map(c => ({ id: c.id, name: c.name, created: c.created_date })),
      });
    }

    // ─ PASS 6: Cross-reference errors (fictional_relationships pointing to non-existent characters) ─
    characters.forEach(char => {
      (char.fictional_relationships || []).forEach((rel, idx) => {
        if (rel.related_character_id && !characters.find(c => c.id === rel.related_character_id)) {
          findings.issues.crossReferenceErrors.push({
            charId: char.id,
            charName: char.name,
            brokenRelId: rel.related_character_id,
            personName: rel.person_name,
          });
        }
      });
    });

    // ─ Generate summary ─
    const totalIssues = Object.values(findings.issues).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    findings.summary = `Found ${totalIssues} total issues:
- ${findings.issues.duplicateNames.length} duplicate name group(s)
- ${findings.issues.npcMatchingActiveChar.length} NPC(s) matching active character names
- ${findings.issues.incorrectFamilyReferences.length} family member(s) that should link to active character(s)
- ${findings.issues.ghostNPCs.length} ghost NPC(s) with no references
- ${findings.issues.worldNameInconsistencies.length} world name consistency issue(s)
- ${findings.issues.crossReferenceErrors.length} broken cross-reference(s)`;

    return Response.json(findings);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});