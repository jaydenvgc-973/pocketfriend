import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { text, voice, voiceStyleNote, apiKey } = await req.json();

    if (!text || !voice || !apiKey) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Call OpenAI TTS API
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text.substring(0, 4096),
        voice: voice,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ error: `OpenAI API error: ${error}` }, { status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));
    const audioUrl = `data:audio/mpeg;base64,${base64Audio}`;

    // Estimate minutes used (rough calculation: ~5 minutes per 1M characters)
    const estimatedMinutes = (text.length / 1000000) * 5;

    return Response.json({
      success: true,
      audioUrl: audioUrl,
      estimatedMinutes: estimatedMinutes,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});