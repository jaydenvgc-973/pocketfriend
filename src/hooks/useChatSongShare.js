import { base44 } from "@/api/base44Client";

export function useChatSongShare({
  characterId,
  character,
  conversationIdRef,
  queryClient,
  setSendError,
}) {
  const handleShareSong = async (mediaLink, isVideo = false) => {
    if (!character || !conversationIdRef.current) {
      console.warn('[handleShareSong] Missing character or conversationId');
      return;
    }
    console.log('[handleShareSong] Processing:', mediaLink, 'isVideo:', isVideo);
    try {
      const res = await base44.functions.invoke('processSongLink', {
        characterId,
        songLink: mediaLink,
        isVideo,
      });
      console.log('[handleShareSong] Full response:', res);

      if (res?.data?.success) {
        let msgData = {
          conversation_id: conversationIdRef.current,
          sender_type: 'user',
          timestamp: new Date().toISOString(),
          content: '',
        };

        if (isVideo) {
          msgData.videos_watched = res.data.video ? [res.data.video] : [];
        } else {
          msgData.songs_heard = res.data.songs?.length > 0
            ? res.data.songs
            : res.data.song
            ? [res.data.song]
            : [];
        }

        console.log('[handleShareSong] Creating message with:', msgData);
        const newMsg = await base44.entities.Message.create(msgData);
        console.log('[handleShareSong] Message created:', newMsg?.id);

        await base44.entities.Conversation.update(conversationIdRef.current, {
          last_message_preview: msgData.content,
          last_message_date: new Date().toISOString(),
        });
        queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });

        // Media research chain — deferred 8s, runs once per share, gated by rate-limit flag.
        // Three sequential backend calls are intentional (each depends on the prior result).
        // Staggered start ensures it does not compete with any active chat response.
        if (msgData.songs_heard?.length > 0) {
          setTimeout(async () => {
            if (window.__chatRateLimited) {
              console.log('[SongShare] SKIP media research chain — rate limit active');
              return;
            }
            for (const song of msgData.songs_heard) {
              try {
                const res1 = await base44.functions.invoke('analyzeMediaUnderstanding', { mediaObject: song, sources: {} });
                const understanding = res1?.data?.understanding;
                const res2 = await base44.functions.invoke('deepMediaResearch', { mediaObject: song, tracks: song.tracks || [] });
                const deepResearch = res2?.data?.deepResearch;
                const res3 = await base44.functions.invoke('buildCharacterMediaKnowledge', { character, mediaObject: song, understanding, deepResearch });
                const knowledge = res3?.data?.knowledge;
                await base44.entities.Message.update(newMsg.id, {
                  songs_heard: msgData.songs_heard.map(s =>
                    s.spotify_id === song.spotify_id
                      ? { ...s, _understanding: understanding, _deepResearch: deepResearch, _characterKnowledge: knowledge }
                      : s
                  ),
                }).catch(err => console.warn(`[SongShare] Message.update for media knowledge failed:`, err?.message));
                console.log(`[Media Research] Complete for "${song.title}": ${knowledge?.knowledgeLevel?.level || 'unknown'}`);
              } catch (err) {
                const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit');
                if (is429) {
                  console.warn('[SongShare] 429 during media research chain — aborting remaining songs');
                  window.__chatRateLimited = true;
                  setTimeout(() => { window.__chatRateLimited = false; }, 60000);
                  break;
                }
                console.warn(`[SongShare] Media research failed for "${song.title}":`, err?.message);
              }
            }
          }, 8000);
        }

        queryClient.invalidateQueries({ queryKey: ["character", characterId] });
      } else {
        console.error('[handleShareSong] processSongLink returned success=false');
        setSendError(`Couldn't process the link. Try another.`);
      }
    } catch (err) {
      console.error('[handleShareSong] Error:', err.message);
      if (err.message.includes('timed out')) {
        setSendError('Link processing took too long. Try a different link.');
      } else if (err.message.includes('502') || err.message.includes('Bad gateway')) {
        setSendError('Service temporarily unavailable. Try again in a moment.');
      } else {
        setSendError(`Couldn't process that link.`);
      }
    }
  };

  return { handleShareSong };
}