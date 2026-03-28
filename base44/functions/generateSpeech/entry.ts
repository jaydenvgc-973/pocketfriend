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

    // Convert ArrayBuffer to Blob for upload
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    
    // Create a File object for upload (backend needs this format)
    const audioFile = new File([audioBlob], `speech_${Date.now()}.mp3`, { type: 'audio/mpeg' });
    
    // Upload audio file to storage via Base44
    console.log(`[generateSpeech] Uploading audio file to storage...`);
    const uploadRes = await base44.integrations.Core.UploadFile({ file: audioFile });
    const fileUrl = uploadRes.file_url;
    
    if (!fileUrl) {
      throw new Error('Failed to get file URL from upload');
    }
    
    console.log(`[generateSpeech] ✓ Audio uploaded successfully`);
    console.log(`[generateSpeech] Stored file URL: ${fileUrl}`);
    console.log(`[generateSpeech] URL length: ${fileUrl.length} chars (within limits)`);

    // Estimate minutes used (rough: ~1000 chars = ~1 second of speech ≈ 0.000278 minutes)
    const estimatedMinutes = Math.max(0.1, (cleanedText.length / 1000) * (1/60) * 0.5);

    console.log(`[generateSpeech] Success - generated ${audioBuffer.byteLength} byte audio from "${cleanedText.substring(0, 50)}..."`);
    console.log(`[generateSpeech] Estimated usage: ${estimatedMinutes.toFixed(3)} minutes`);

    return Response.json({
      success: true,
      audioUrl: fileUrl,
      estimatedMinutes: estimatedMinutes,
      bytesGenerated: audioBuffer.byteLength,
    });
  } catch (error) {
    console.error(`[generateSpeech] Error: ${error.message}`);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});