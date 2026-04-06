import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Validates that a location exists in the real world via Google Places API
 * and checks if it's currently open.
 * Returns location details (name, hours, address) if valid and open.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { locationName, city, state } = await req.json();
    
    if (!locationName || !city) {
      return Response.json({ error: 'Location name and city required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Places API key not configured' }, { status: 500 });
    }

    // Search for the location
    const query = `${locationName} ${city}${state ? ` ${state}` : ''}`;
    const searchResponse = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&key=${apiKey}&fields=place_id,formatted_name,opening_hours,business_status`
    );

    const searchData = await searchResponse.json();
    
    if (!searchData.candidates || searchData.candidates.length === 0) {
      return Response.json({ exists: false, message: 'Location not found' });
    }

    const place = searchData.candidates[0];
    const placeId = place.place_id;

    // Get detailed place info including current open status
    const detailResponse = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${apiKey}&fields=name,formatted_address,opening_hours,business_status,formatted_phone_number,website`
    );

    const detailData = await detailResponse.json();
    const details = detailData.result;

    // Check if currently open
    const isOpen = details.opening_hours?.open_now;
    const businessStatus = details.business_status; // OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY

    if (businessStatus === 'CLOSED_PERMANENTLY') {
      return Response.json({ 
        exists: true, 
        isOpen: false, 
        message: `${details.name} is permanently closed`,
        name: details.name,
        address: details.formatted_address,
      });
    }

    if (businessStatus === 'CLOSED_TEMPORARILY') {
      return Response.json({ 
        exists: true, 
        isOpen: false, 
        message: `${details.name} is temporarily closed`,
        name: details.name,
        address: details.formatted_address,
      });
    }

    if (isOpen === false) {
      // Get next opening time if available
      const weekday = new Date().getDay();
      const hours = details.opening_hours?.weekday_text?.[weekday] || 'Check hours';
      return Response.json({ 
        exists: true, 
        isOpen: false, 
        message: `${details.name} is currently closed`,
        hours,
        name: details.name,
        address: details.formatted_address,
      });
    }

    // Location is valid and open
    return Response.json({
      exists: true,
      isOpen: true,
      name: details.name,
      address: details.formatted_address,
      phone: details.formatted_phone_number,
      website: details.website,
      message: `${details.name} is open now`,
    });

  } catch (error) {
    console.error('Validation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});