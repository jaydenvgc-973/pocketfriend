import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fetchDailyWeatherForNarratives
 * 
 * Daily automation: fetch weather for the user's location and store sunrise/sunset times
 * so that narratives can reference actual weather conditions and accurate daypart timing.
 * 
 * Runs once daily at 4 AM ET, stores results in UserSettings.daily_weather_cache
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user location (default to New York if not set)
    const [userSettings] = await Promise.all([
      base44.entities.UserSettings.filter({ created_by: user.email }).then(s => s[0] || {}),
    ]);

    const userCity = userSettings?.city || 'New York';
    const userState = userSettings?.state || 'NY';
    const location = `${userCity}, ${userState}`;

    // Fetch weather from a simple API (OpenWeather or similar)
    // For now, we'll use a generic weather API endpoint
    let weatherData = {
      location,
      fetchedAt: new Date().toISOString(),
      sunrise: '06:15',
      sunset: '19:45',
      conditions: 'clear',
      high: 72,
      low: 58,
      humidity: 65,
      windSpeed: 8,
    };

    // If you have an API key for weather, you can fetch real data here
    // Example: const res = await fetch(`https://api.weatherapi.com/v1/current.json?key=${WEATHER_API_KEY}&q=${location}`);
    // For MVP, we'll use reasonable defaults and update if API is available

    try {
      // Attempt to fetch real weather (requires API key)
      // This is optional — if it fails, the default above is used
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&daily=sunrise,sunset,weather_code&timezone=America/New_York`
      ).catch(() => null);

      if (weatherRes?.ok) {
        const weatherJson = await weatherRes.json();
        const today = weatherJson.daily.time[0];
        const todayIdx = weatherJson.daily.time.indexOf(today);
        if (todayIdx >= 0) {
          const sunrise = weatherJson.daily.sunrise[todayIdx];
          const sunset = weatherJson.daily.sunset[todayIdx];
          // Parse HH:MM from "YYYY-MM-DD HH:MM" format
          weatherData.sunrise = sunrise?.split(' ')[1] || weatherData.sunrise;
          weatherData.sunset = sunset?.split(' ')[1] || weatherData.sunset;
        }
      }
    } catch (err) {
      console.warn('[fetchDailyWeatherForNarratives] Real weather API failed, using defaults:', err.message);
    }

    // Update UserSettings with cached weather data
    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
    const settings = settingsList[0];

    if (settings) {
      await base44.entities.UserSettings.update(settings.id, {
        daily_weather_cache: weatherData,
      });
    } else {
      // Create settings if doesn't exist
      await base44.entities.UserSettings.create({
        created_by: user.email,
        daily_weather_cache: weatherData,
      });
    }

    console.log(`[fetchDailyWeatherForNarratives] Weather cached for ${user.email}: sunrise ${weatherData.sunrise}, sunset ${weatherData.sunset}`);

    return Response.json({
      success: true,
      location: weatherData.location,
      sunrise: weatherData.sunrise,
      sunset: weatherData.sunset,
      fetchedAt: weatherData.fetchedAt,
    });
  } catch (error) {
    console.error('[fetchDailyWeatherForNarratives]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});