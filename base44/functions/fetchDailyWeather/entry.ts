import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const apiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!apiKey) {
      return Response.json({ error: 'OPENWEATHER_API_KEY not set' }, { status: 500 });
    }

    const characters = await base44.asServiceRole.entities.Character.list();
    const activeChars = characters.filter(c => c.status === 'active' && (c.city || c.state));

    // Deduplicate locations
    const locationMap = {};
    for (const char of activeChars) {
      const locationKey = [char.city, char.state].filter(Boolean).join(", ");
      if (locationKey && !locationMap[locationKey]) {
        locationMap[locationKey] = [];
      }
      if (locationKey) locationMap[locationKey].push(char.id);
    }

    const now = new Date().toISOString();
    let updated = 0;

    for (const [location, charIds] of Object.entries(locationMap)) {
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=imperial`;
      const res = await fetch(url);

      if (!res.ok) {
        console.warn(`Failed to fetch weather for ${location}: ${res.status}`);
        continue;
      }

      const data = await res.json();

      const temp = Math.round(data.main?.temp);
      const feels_like = Math.round(data.main?.feels_like);
      const condition = data.weather?.[0]?.description || "unknown";
      const humidity = data.main?.humidity;
      const wind_speed = Math.round(data.wind?.speed);

      const weather_summary = `${condition}, ${temp}°F (feels like ${feels_like}°F), humidity ${humidity}%, wind ${wind_speed} mph`;

      for (const charId of charIds) {
        await base44.asServiceRole.entities.Character.update(charId, {
          weather_summary,
          weather_last_updated: now,
        });
        updated++;
      }
    }

    return Response.json({ success: true, updated, locations: Object.keys(locationMap).length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});