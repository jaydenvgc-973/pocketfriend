import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OPENAI_TTS_API = 'https://api.openai.com/v1/audio/speech';
const TTS_MODEL = 'tts-1';
const MAX_CHARS = 4096;
const CHUNK_SIZE = 2000;

// Split text into chunks respecting sentence boundaries
function chunkText(text, maxChars = CHUNK_SIZE) {
  if (text.length <= maxChars) return [text];
  
  const chunks = [];
  let currentChunk = '';
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChars) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

// Generate speech for a text chunk
async function generateChunk(text, voice, apiKey) {
  if (!text.trim()) return null;
  
  const body = JSON.stringify({
    model: TTS_MODEL,
    input: text.substring(0, MAX_CHARS),
    voice: voice || 'alloy',
    response_format: 'mp3'
  });
  
  const res = await fetch(OPENAI_TTS_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error: ${res.status} - ${errText}`);
  }
  
  return res.arrayBuffer();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { text, voice, voiceStyleNote, apiKey } = await req.json();
    
    if (!text || !apiKey) {
      return Response.json({ error: 'Missing text or API key' }, { status: 400 });
    }
    
    // Prepare prompt enhancement if style note provided
    let finalText = text;
    if (voiceStyleNote) {
      finalText = `${text} (Voice style: ${voiceStyleNote})`;
    }
    
    // Split text into chunks
    const chunks = chunkText(finalText);
    if (chunks.length === 0) {
      return Response.json({ error: 'No text to generate' }, { status: 400 });
    }
    
    // Generate audio for first chunk (most important)
    let audioData;
    try {
      audioData = await generateChunk(chunks[0], voice, apiKey);
    } catch (genErr) {
      return Response.json({ error: genErr.message }, { status: 500 });
    }
    
    if (!audioData) {
      return Response.json({ error: 'Failed to generate audio' }, { status: 500 });
    }
    
    // Convert to base64 for transmission
    const audioArray = new Uint8Array(audioData);
    let binaryString = '';
    for (let i = 0; i < audioArray.length; i += 8192) {
      binaryString += String.fromCharCode(...audioArray.slice(i, i + 8192));
    }
    const audioBase64 = btoa(binaryString);
    const audioDataUrl = `data:audio/mpeg;base64,${audioBase64}`;
    
    // Calculate approximate duration (rough: ~150 words per minute)
    const wordCount = chunks[0].split(/\s+/).length;
    const estimatedMinutes = wordCount / 150;
    
    return Response.json({
      success: true,
      audioUrl: audioDataUrl,
      estimatedMinutes: Math.max(0.1, Math.round(estimatedMinutes * 10) / 10),
    });
  } catch (error) {
    console.error('Speech generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});