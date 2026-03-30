import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

async function fetchWeatherForLocation(city, state) {
  try {
    const query = state ? `${city}, ${state}` : city;
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(query)}?format=j1`,
      { headers: { 'User-Agent': 'Pocketfriend' } }
    );
    if (!res.ok) return null;
    
    const data = await res.json();
    const current = data.current_condition[0];
    const forecast = data.weather.slice(0, 7); // 7-day forecast
    
    return {
      current: `${current.temp_C}°C, ${current.weatherDesc[0].value}`,
      forecast: forecast.map(day => ({
        date: day.date,
        maxTemp: day.maxtemp_c,
        minTemp: day.mintemp_c,
        condition: day.weatherDesc[0].value
      }))
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    const hour = now.getHours();
    
    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      '-updated_date',
      100
    );

    const updated = [];

    for (const character of characters) {
      if (!character.city && !character.state) continue;

      const shouldCheckDaily = hour >= 6 && hour < 10; // Daily: 6-10 AM
      const shouldCheckWeekly = dayOfWeek === 0 && hour >= 3 && hour < 5; // Sunday 3-5 AM (4 AM target)

      if (!shouldCheckDaily && !shouldCheckWeekly) continue;

      const weather = await fetchWeatherForLocation(character.city, character.state);
      if (!weather) continue;

      const updateData = {
        weather_last_updated: now.toISOString(),
      };

      if (shouldCheckDaily) {
        // Daily: just today's summary
        updateData.weather_summary = weather.current;
      } else if (shouldCheckWeekly) {
        // Weekly: full 7-day forecast for planning
        const forecastStr = weather.forecast
          .map(d => `${d.date}: ${d.maxTemp}°C/${d.minTemp}°C, ${d.condition}`)
          .join('; ');
        updateData.weather_summary = `Weekly forecast: ${forecastStr}`;
      }

      await base44.asServiceRole.entities.Character.update(character.id, updateData);
      updated.push({ id: character.id, name: character.name, check_type: shouldCheckWeekly ? 'weekly' : 'daily' });
    }

    return Response.json({
      success: true,
      weather_checks: updated.length,
      characters_checked: updated
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});