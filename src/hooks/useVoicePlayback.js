import { useState } from "react";
import { base44 } from "@/api/base44Client";

const voiceCache = new Map();
const activeAudioRef = new Map();

export function useVoicePlayback(chatType) {
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [voiceErrors, setVoiceErrors] = useState({});

  const playAudio = async (messageId, audioUrl) => {
    const diagnosticId = `[PLAYBACK-${messageId.substring(0, 8)}]`;
    return new Promise((resolve) => {
      try {
        const existingAudio = activeAudioRef.get(messageId);
        if (existingAudio) {
          existingAudio.pause();
          existingAudio.currentTime = 0;
        }
        const audio = new Audio(audioUrl);
        activeAudioRef.set(messageId, audio);
        audio.onended = () => { activeAudioRef.delete(messageId); setPlayingAudioId(null); resolve(); };
        audio.onerror = () => { activeAudioRef.delete(messageId); setPlayingAudioId(null); resolve(); };
        audio.play().catch(() => { activeAudioRef.delete(messageId); setPlayingAudioId(null); resolve(); });
      } catch {
        setPlayingAudioId(null);
        resolve();
      }
    });
  };

  const playCharacterVoice = async (messageId, text, characterData, userSettings, bypassCache = false) => {
    if (!messageId || !text || !characterData || !userSettings) {
      setPlayingAudioId(null);
      return;
    }

    try {
      setVoiceErrors(prev => ({ ...prev, [messageId]: null }));
      setPlayingAudioId(messageId);

      const voiceGloballyEnabled = userSettings?.voice_enabled === true;
      const charHasVoice = characterData?.voice_enabled === true && characterData?.voice_name;
      const hasApiKey = userSettings?.openai_api_key;
      const isNotPhone = chatType !== "phone";

      if (!voiceGloballyEnabled || !charHasVoice || !hasApiKey || !isNotPhone) {
        setPlayingAudioId(null);
        return;
      }

      const cacheKey = `${characterData.id}_${characterData.voice_name}_${text}`;
      let audioUrl = voiceCache.get(cacheKey);

      if (audioUrl && !bypassCache) {
        await playAudio(messageId, audioUrl);
        return;
      }

      const res = await base44.functions.invoke('generateSpeech', {
        text,
        voice: characterData.voice_name,
        voiceStyleNote: characterData.voice_style_note,
        apiKey: userSettings.openai_api_key,
      });

      if (!res?.data?.audioUrl) throw new Error('No audio URL returned from generateSpeech');

      audioUrl = res.data.audioUrl;
      voiceCache.set(cacheKey, audioUrl);

      await base44.entities.Message.update(messageId, { audio_url: audioUrl });

      const estimatedMinutes = res.data.estimatedMinutes || 0.1;
      if (userSettings.id) {
        base44.entities.UserSettings.update(userSettings.id, {
          voice_minutes_used: (userSettings.voice_minutes_used || 0) + estimatedMinutes,
        }).catch(() => {});
      }

      await playAudio(messageId, audioUrl);
    } catch (err) {
      setVoiceErrors(prev => ({ ...prev, [messageId]: err.message }));
      setPlayingAudioId(null);
    }
  };

  return { playingAudioId, voiceErrors, playCharacterVoice };
}