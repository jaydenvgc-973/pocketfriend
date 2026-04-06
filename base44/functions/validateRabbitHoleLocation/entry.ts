import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Validates that a rabbit hole location (bar/restaurant) exists in the real world,
 * is in the correct city, and is currently open.
 *
 * Input: { locationName, characterCity, characterId }
 * Output: { valid, businessName, address, openNow, reason }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { locationName, characterCity, characterId } = await req.json();

    if (!locationName || !characterCity) {
      return Response.json({ 
        valid: false, 
        reason: 'Missing location name or city' 
      }, { status: 400 });
    }

    // Use web search to validate the location exists
    const searchRes = await base44.integrations.Core.InvokeLLM({
      prompt: `Validate this location and return JSON:
Location: "${locationName}"
City: "${characterCity}"

Search for a real business/venue with this name in this city. If found, return:
{
  "found": true,
  "businessName": "exact official name",
  "address": "street address",
  "city": "${characterCity}",
  "openingHours": "typical hours like 5pm-2am",
  "isOpen": true/false (based on time now)
}

If NOT found or out of city:
{
  "found": false,
  "reason": "why not"
}`,
      response_json_schema: {
        type: "object",
        properties: {
          found: { type: "boolean" },
          businessName: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          openingHours: { type: "string" },
          isOpen: { type: "boolean" },
          reason: { type: "string" }
        }
      }
    });

    const result = searchRes;
    
    if (!result.found) {
      return Response.json({
        valid: false,
        reason: result.reason || 'Location not found',
        rejected: true
      });
    }

    if (!result.isOpen) {
      return Response.json({
        valid: false,
        reason: `${result.businessName} is closed now (hours: ${result.openingHours})`,
        rejected: true
      });
    }

    // Valid location
    return Response.json({
      valid: true,
      businessName: result.businessName,
      address: result.address,
      city: result.city,
      openingHours: result.openingHours,
      isOpenNow: true
    });
  } catch (error) {
    console.error('Validation error:', error);
    return Response.json({ 
      valid: false, 
      reason: 'Validation failed',
      error: error.message 
    }, { status: 500 });
  }
});