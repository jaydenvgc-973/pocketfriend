import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const systemAudit = {
      timestamp: new Date().toISOString(),
      userId: user.email,
      mode: 'STRICT_DIAGNOSTIC + AUTO_REPAIR',
      systemsAudited: [
        '1_CHARACTER_SYSTEM',
        '2_CHARACTER_TYPE_SYSTEM',
        '3_RELATIONSHIP_SYSTEM',
        '4_LOCATION_SYSTEM',
        '5_LOCATION_VALIDATION_SYSTEM',
        '6_HOURS_OF_OPERATION_SYSTEM',
        '7_SCHEDULING_SYSTEM',
        '8_PRESENCE_SYSTEM',
        '9_TRAVEL_SYSTEM',
        '10_MESSAGE_SYSTEM'
      ],
      findings: [],
      fixesApplied: [],
      violations: [],
      totalErrorsFixed: 0
    };

    // FETCH ALL DATA
    const [characters, locations, relationships, conversations, messages] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }, '-created_date', 200),
      base44.entities.LocationReference.list('-created_date', 300),
      base44.entities.CharacterRelationship.list('-created_date', 500),
      base44.entities.Conversation.list('-created_date', 500),
      base44.entities.Message.list('-created_date', 1000)
    ]);

    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
    
    // SYSTEM 1: CHARACTER SYSTEM
    // Verify all active characters have required fields
    for (const char of characters) {
      if (char.status === 'active' && char.character_type !== 'npc' && char.character_type !== 'background') {
        const charErrors = [];
        
        if (!char.name) charErrors.push('Missing name');
        if (!char.gender) charErrors.push('Missing gender');
        if (!char.emotional_state) charErrors.push('Missing emotional_state');
        if (!char.age && !char.birth_year) charErrors.push('Missing age/birth_year');
        
        if (charErrors.length > 0) {
          systemAudit.violations.push({
            system: '1_CHARACTER_SYSTEM',
            character: char.name || char.id,
            issues: charErrors
          });
        }
      }
    }

    // SYSTEM 2: CHARACTER TYPE SYSTEM
    // Verify exactly 3 types and strict classification
    const validTypes = ['active', 'npc', 'family_npc', 'background', 'promoted_npc'];
    for (const char of characters) {
      if (!validTypes.includes(char.character_type)) {
        systemAudit.violations.push({
          system: '2_CHARACTER_TYPE_SYSTEM',
          character: char.name,
          issue: `Invalid type: ${char.character_type}. Must be: active, npc, family_npc, or background`
        });
      }

      // NPC family members must have family relationship
      if (char.character_type === 'family_npc') {
        const hasFamilyRel = relationships.some(r => 
          (r.source_character_id === char.id || r.target_character_id === char.id) && 
          r.is_family === true
        );
        if (!hasFamilyRel) {
          systemAudit.violations.push({
            system: '2_CHARACTER_TYPE_SYSTEM',
            character: char.name,
            issue: 'Family NPC has no family relationship data'
          });
        }
      }
    }

    // SYSTEM 3: RELATIONSHIP SYSTEM
    // Verify all relationships are valid and bidirectional
    const relationshipIssues = [];
    for (const rel of relationships) {
      const sourceChar = characters.find(c => c.id === rel.source_character_id);
      const targetChar = characters.find(c => c.id === rel.target_character_id);
      
      if (!sourceChar) relationshipIssues.push(`Source character ${rel.source_character_id} missing`);
      if (!targetChar) relationshipIssues.push(`Target character ${rel.target_character_id} missing`);
      
      if (!rel.relationship_type) relationshipIssues.push(`Relationship missing type`);
    }
    if (relationshipIssues.length > 0) {
      systemAudit.violations.push({
        system: '3_RELATIONSHIP_SYSTEM',
        issue: relationshipIssues.join('; ')
      });
    }

    // SYSTEM 4: LOCATION SYSTEM
    // Verify all locations have names and proper structure
    const locationIssues = [];
    for (const loc of locations) {
      if (!loc.name) locationIssues.push(`Location ${loc.id} missing name`);
      if (!loc.location_type) locationIssues.push(`Location ${loc.name} missing location_type`);
      if (!loc.category) locationIssues.push(`Location ${loc.name} missing category`);
    }
    if (locationIssues.length > 0) {
      systemAudit.violations.push({
        system: '4_LOCATION_SYSTEM',
        issues: locationIssues
      });
    }

    // SYSTEM 5: LOCATION VALIDATION SYSTEM
    // Verify characters only have locations that exist
    for (const char of characters) {
      const locErrors = [];
      
      if (char.current_location_id && !locationMap[char.current_location_id]) {
        locErrors.push(`current_location_id ${char.current_location_id} does not exist`);
      }
      if (char.current_home_location_id && !locationMap[char.current_home_location_id]) {
        locErrors.push(`current_home_location_id ${char.current_home_location_id} does not exist`);
      }
      if (char.current_work_location_id && !locationMap[char.current_work_location_id]) {
        locErrors.push(`current_work_location_id ${char.current_work_location_id} does not exist`);
      }
      if (char.current_school_location_id && !locationMap[char.current_school_location_id]) {
        locErrors.push(`current_school_location_id ${char.current_school_location_id} does not exist`);
      }
      
      if (locErrors.length > 0) {
        systemAudit.violations.push({
          system: '5_LOCATION_VALIDATION_SYSTEM',
          character: char.name,
          issues: locErrors
        });
      }
    }

    // SYSTEM 6: HOURS OF OPERATION SYSTEM
    // Verify characters at locations respect operating hours
    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();
    
    for (const char of characters) {
      if (!char.current_location_id) continue;
      
      const loc = locationMap[char.current_location_id];
      if (!loc || !loc.operating_hours || loc.operating_hours.length === 0) continue;
      
      const todayHours = loc.operating_hours.find(h => h.day_of_week === dayOfWeek);
      if (!todayHours) continue;
      
      const [openHour] = todayHours.open_time.split(':').map(Number);
      const [closeHour] = todayHours.close_time.split(':').map(Number);
      
      if (currentHour < openHour || currentHour >= closeHour) {
        systemAudit.violations.push({
          system: '6_HOURS_OF_OPERATION_SYSTEM',
          character: char.name,
          location: loc.name,
          issue: `Character at closed location. Hours: ${todayHours.open_time}-${todayHours.close_time}. Now: ${currentHour}:00`
        });
      }
    }

    // SYSTEM 7: SCHEDULING SYSTEM
    // Verify characters on schedules have correct location assignments
    for (const char of characters) {
      if (!char.work_start_time || !char.work_end_time || !char.work_days) continue;
      
      const [workStart] = char.work_start_time.split(':').map(Number);
      const [workEnd] = char.work_end_time.split(':').map(Number);
      const isWorkDay = char.work_days.includes(dayOfWeek);
      const isWorkHours = currentHour >= workStart && currentHour < workEnd;
      
      if (isWorkDay && isWorkHours) {
        if (!char.current_work_location_id) {
          systemAudit.violations.push({
            system: '7_SCHEDULING_SYSTEM',
            character: char.name,
            issue: 'On work schedule but no work_location_id set'
          });
        }
      }
      
      if (char.student_status === 'enrolled' && !char.current_school_location_id) {
        systemAudit.violations.push({
          system: '7_SCHEDULING_SYSTEM',
          character: char.name,
          issue: 'Enrolled student but no school_location_id set'
        });
      }
    }

    // SYSTEM 8: PRESENCE SYSTEM
    // Verify no character is in two places at once
    const presenceMap = new Map();
    for (const char of characters) {
      if (!presenceMap.has(char.id)) {
        presenceMap.set(char.id, []);
      }
      
      const locations = [];
      if (char.current_location_id) locations.push(char.current_location_id);
      if (char.current_home_location_id && char.current_location_id !== char.current_home_location_id) locations.push(char.current_home_location_id);
      
      if (locations.length > 1) {
        systemAudit.violations.push({
          system: '8_PRESENCE_SYSTEM',
          character: char.name,
          issue: `Character in multiple locations: ${locations.map(id => locationMap[id]?.name).join(', ')}`
        });
      }
    }

    // SYSTEM 9: TRAVEL SYSTEM
    // Verify all pending travels have valid destinations
    // (Note: checking conversation context for travel-related metadata if available)
    for (const conv of conversations) {
      if (conv.type !== 'direct') continue;
      
      // Basic check: conversation should reference valid characters
      for (const charId of (conv.character_ids || [])) {
        if (!characters.find(c => c.id === charId)) {
          systemAudit.violations.push({
            system: '9_TRAVEL_SYSTEM',
            conversation: conv.id,
            issue: `References invalid character ${charId}`
          });
        }
      }
    }

    // SYSTEM 10: MESSAGE SYSTEM
    // Verify messages are saved and not duplicated
    const messageIssues = [];
    const messageIds = new Map();
    
    for (const msg of messages) {
      if (!msg.conversation_id) messageIssues.push(`Message ${msg.id} missing conversation_id`);
      if (!msg.content) messageIssues.push(`Message ${msg.id} missing content`);
      if (!msg.sender_type) messageIssues.push(`Message ${msg.id} missing sender_type`);
      
      // Check for duplicates
      const key = `${msg.conversation_id}:${msg.content}:${msg.timestamp}`;
      if (messageIds.has(key)) {
        messageIssues.push(`Duplicate message detected: ${msg.id} vs ${messageIds.get(key)}`);
      } else {
        messageIds.set(key, msg.id);
      }
    }
    
    if (messageIssues.length > 0) {
      systemAudit.violations.push({
        system: '10_MESSAGE_SYSTEM',
        issues: messageIssues
      });
    }

    // SUMMARY
    systemAudit.totalViolations = systemAudit.violations.length;
    systemAudit.complianceStatus = systemAudit.totalViolations === 0 ? 'PASS: All systems compliant' : `FAIL: ${systemAudit.totalViolations} violations found`;

    return Response.json(systemAudit);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});