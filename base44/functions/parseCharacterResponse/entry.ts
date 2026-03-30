import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Parse character response into separate action and dialogue components.
 * 
 * Input: raw character response text or structured object
 * Output: { action: string|null, dialogue: string|null }
 * 
 * This allows the system to treat actions and dialogue as separate entities
 * while still using the existing Message storage system.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterResponse, characterName } = await req.json();
    
    if (!characterResponse) {
      return Response.json({ action: null, dialogue: null });
    }

    // Parse the response
    // If it's already structured, use it as-is
    if (typeof characterResponse === 'object' && characterResponse.action !== undefined) {
      return Response.json({
        action: characterResponse.action?.trim() || null,
        dialogue: characterResponse.dialogue?.trim() || null,
      });
    }

    // If it's a string, attempt to detect action vs dialogue
    // Action pattern: starts with character name + verb (walks, moves, looks, etc.)
    const responseStr = String(characterResponse).trim();
    
    if (!responseStr) {
      return Response.json({ action: null, dialogue: null });
    }

    // Check if response starts with a narrative action pattern
    // Pattern: "CharacterName verb..." or "CharacterName and ..." or "CharacterName's ..."
    const actionPattern = new RegExp(`^${characterName}\\s+(and\\s+|'s\\s+|[a-z]+)`, 'i');
    
    let action = null;
    let dialogue = null;

    // Split by quotation marks to separate narrative from dialogue
    const quoteMatch = responseStr.match(/^(.*?)(?:"([^"]*)"|$)/s);
    
    if (quoteMatch) {
      const beforeQuote = quoteMatch[1]?.trim();
      const quotedText = quoteMatch[2]?.trim();

      // Check if there's meaningful narrative content before quotes
      if (beforeQuote && beforeQuote.length > 5 && actionPattern.test(beforeQuote)) {
        action = beforeQuote;
      }

      // Check if there's dialogue after quotes
      if (quotedText && quotedText.length > 3) {
        dialogue = quotedText;
      } else if (!action && beforeQuote) {
        // If no quotes but narrative content, treat as dialogue
        dialogue = beforeQuote;
      }
    } else {
      // No quotes found - treat as dialogue or action based on pattern
      if (actionPattern.test(responseStr)) {
        action = responseStr;
      } else {
        dialogue = responseStr;
      }
    }

    return Response.json({
      action: action,
      dialogue: dialogue,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});