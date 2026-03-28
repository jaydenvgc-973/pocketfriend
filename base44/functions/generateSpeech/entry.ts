import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { text, voice, voiceStyleNote, apiKey } = body;

    // Validate inputs
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return Response.json({ error: 'Text is required and must be non-empty' }, { status: 400 });
    }
    if (!voice || typeof voice !== 'string') {
      return Response.json({ error: 'Voice is required' }, { status: 400 });
    }
    if (!apiKey || typeof apiKey !== 'string') {
      return Response.json({ error: 'OpenAI API key is required' }, { status: 400 });
    }

    // Clean text: remove image prompts, system instructions
    const cleanedText = text
      .replace(/\[USER\]/gi, '')
      .replace(/\[CHARACTER\]/gi, '')
      .replace(/\[JOINT\]/gi, '')
      .replace(/\[image_prompt[^\]]*\]/gi, '')
      .trim();

    if (!cleanedText) {
      return Response.json({ error: 'No speakable text after filtering' }, { status: 400 });
    }

    // Call OpenAI TTS API
    console.log(`[generateSpeech] Calling OpenAI TTS for voice: ${voice}, text length: ${cleanedText.length}`);
    
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: cleanedText.substring(0, 4096),
        voice: voice,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[generateSpeech] OpenAI API error: ${response.status} - ${error}`);
      return Response.json({ 
        error: `OpenAI API error: ${response.status}`, 
        details: error 
      }, { status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();
    console.log(`[generateSpeech] Audio received: ${audioBuffer.byteLength} bytes`);
    
    // Convert to base64 for data URL
    const uint8Array = new Uint8Array(audioBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Audio = btoa(binary);
    const audioUrl = `data:audio/mpeg;base64,${base64Audio}`;

    // Estimate minutes used
    const estimatedMinutes = (cleanedText.length / 1000000) * 5;

    console.log(`[generateSpeech] Success - generated audio, estimated ${estimatedMinutes.toFixed(3)} minutes`);

    return Response.json({
      success: true,
      audioUrl: audioUrl,
      estimatedMinutes: Math.max(0.1, estimatedMinutes),
    });
  } catch (error) {
    console.error(`[generateSpeech] Error: ${error.message}`);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});