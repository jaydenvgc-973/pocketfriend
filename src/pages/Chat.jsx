import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import MessageBubble from "@/components/chat/MessageBubble";
import ChatInput from "@/components/chat/ChatInput";
import TypingIndicator from "@/components/chat/TypingIndicator";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import MediaGallery from "@/components/chat/MediaGallery";
import BottomNav from "@/components/BottomNav";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import CharacterStatusPopup from "@/components/character/CharacterStatusPopup";
import NarrativeBuilderPopup from "@/components/chat/NarrativeBuilderPopup";
import { BarChart2, BookOpen } from "lucide-react";

export default function Chat() {
  const { characterId } = useParams();
  const urlParams = new URLSearchParams(window.location.search);
  const chatType = urlParams.get("type") || "direct";
  const isPhone = chatType === "phone";

  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [lastChangeReason, setLastChangeReason] = useState(null);
  const [previousLevels, setPreviousLevels] = useState(null);
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [showNarrativeBuilder, setShowNarrativeBuilder] = useState(false);
  const bottomRef = useRef(null);
  const queryClient = useQueryClient();
  const conversationIdRef = useRef(null);
  const unsubscribeRef = useRef(null);

  const { data: character } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      const chars = await base44.entities.Character.list();
      return chars.find(c => c.id === characterId);
    },
    enabled: !!characterId,
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  useEffect(() => {
    if (!characterId || !character) return;
    const loadConvo = async () => {
      const convos = await base44.entities.Conversation.filter({ type: chatType, character_ids: [characterId] }, "-updated_date", 1);
      let convoId = null;

      if (convos.length > 0) {
        convoId = convos[0].id;
        
        // Always load messages from database for this conversation
        const loadedMsgs = await base44.entities.Message.filter({ conversation_id: convoId }, "created_date");
        setMessages(loadedMsgs);
        setConversationId(convoId);
      }



      // Check for pending proactive messages
      const pending = await base44.entities.PendingMessage.filter({ character_id: characterId, delivered: false });
      if (pending.length > 0 && !convoId) {
        const pm = pending[0];
        const convo = await base44.entities.Conversation.create({
          title: `${chatType} with ${character.name}`,
          type: chatType,
          character_ids: [characterId],
        });
        convoId = convo.id;
        setConversationId(convoId);

        await new Promise(r => setTimeout(r, 1200));

        const charMsg = await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: "character",
          character_id: characterId,
          character_name: character.name,
          content: pm.content,
          image_url: pm.image_url || undefined,
          emotional_state: pm.emotional_state || "calm",
          timestamp: new Date().toISOString(),
        });

        setMessages(prev => [...prev, charMsg]);
        await base44.entities.PendingMessage.update(pm.id, { delivered: true });
        await base44.entities.Conversation.update(convoId, {
          last_message_preview: pm.content.substring(0, 100),
          last_message_date: new Date().toISOString(),
        });
      }
    };

    loadConvo();
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [characterId, character, chatType]);

  useEffect(() => {
    if (!conversationId) return;

    if (unsubscribeRef.current) unsubscribeRef.current();

    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.type === "create" && event.data.conversation_id === conversationId) {
        setMessages(prev => {
          if (prev.some(m => m.id === event.data.id)) return prev;
          return [...prev, event.data];
        });
      }
    });
    unsubscribeRef.current = unsubscribe;

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const [sendError, setSendError] = useState(null);

  const handleDeleteMessage = async (messageId) => {
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
    await base44.entities.Message.delete(messageId);
  };

  const handleReact = async (messageId, emoji) => {
    // Find the message
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;

    // Toggle: if user already reacted with this emoji, remove it
    const existing = (msg.reactions || []).find(r => r.reactor_type === "user" && r.emoji === emoji);
    const updatedReactions = existing
      ? msg.reactions.filter(r => !(r.reactor_type === "user" && r.emoji === emoji))
      : [...(msg.reactions || []), { emoji, reactor_type: "user", reactor_id: "user" }];

    // Optimistic update
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: updatedReactions } : m));
    await base44.entities.Message.update(messageId, { reactions: updatedReactions });

    // If user is reacting to a character's message, trigger character reaction awareness & relationship update
    if (msg.sender_type === "character" && !existing && character) {
      base44.functions.invoke("updateRelationshipLevels", {
        characterId,
        emojiReaction: emoji,
        reactedMessageContent: msg.content || "(image)",
        reactedMessageSenderType: msg.sender_type,
        recentMessages: messages.slice(-10),
      }).then(res => {
        if (res?.data?.reason) setLastChangeReason(res.data.reason);
        queryClient.invalidateQueries({ queryKey: ["character", characterId] });
      }).catch(() => {});

      // Small chance the character reacts back to user messages too
      setTimeout(async () => {
        // Generate character's emoji reaction to a user message if applicable
        if (msg.sender_type === "character") {
          // Character might react to being reacted to (e.g., heart back on their own message)
          // This is a lightweight reaction — no LLM call, just mirror or complement occasionally
          const complementMap = { "❤️": "❤️", "😂": "😂", "😮": null, "😢": "😢", "😡": null, "👍": "👍" };
          const charEmoji = complementMap[emoji];
          if (charEmoji && Math.random() > 0.5) {
            const withCharReaction = [...updatedReactions, { emoji: charEmoji, reactor_type: "character", reactor_id: characterId }];
            await base44.entities.Message.update(messageId, { reactions: withCharReaction });
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: withCharReaction } : m));
          }
        }
      }, 1500 + Math.random() * 2000);
    }

    // If user reacts to their OWN message, character may also react to that message
    if (msg.sender_type === "user" && !existing && character) {
      setTimeout(async () => {
        const reloadedMsg = await base44.entities.Message.get ? null : null; // use current state
        const currentReactions = (messages.find(m => m.id === messageId)?.reactions || updatedReactions);
        const alreadyCharReacted = currentReactions.some(r => r.reactor_type === "character");
        if (!alreadyCharReacted) {
          // Character reacts to user's own message — context-based
          const responseMap = { "❤️": "😮", "😂": "😂", "😢": "😢", "👍": "👍", "😡": "😮", "😮": "😂" };
          const charEmoji = responseMap[emoji];
          if (charEmoji && Math.random() > 0.4) {
            const withCharReaction = [...currentReactions, { emoji: charEmoji, reactor_type: "character", reactor_id: characterId }];
            await base44.entities.Message.update(messageId, { reactions: withCharReaction });
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: withCharReaction } : m));
          }
        }
      }, 2000 + Math.random() * 3000);
    }
  };

  const handleShareSong = async (songLink) => {
    if (!character) return;
    try {
      const res = await base44.functions.invoke('processSongLink', {
        characterId,
        songLink
      });
      if (res?.data?.success) {
        setMessages(prev => [...prev, {
          id: 'system_' + Date.now(),
          conversation_id: conversationIdRef.current,
          sender_type: 'character',
          character_id: characterId,
          character_name: character.name,
          content: `Thanks for the song! "${res.data.song.title}" by ${res.data.song.artist} is great. ${res.data.song.lyrics_excerpt ? `I love the line "${res.data.song.lyrics_excerpt}"` : ''}.`,
          timestamp: new Date().toISOString()
        }]);
        queryClient.invalidateQueries({ queryKey: ["character", characterId] });
      }
    } catch (err) {
      setSendError("Failed to process song link. Try again.");
    }
  };

  const sendMessage = async (text, userImageUrl) => {
    if (!character) return;
    setSendError(null);

    // Check for music platform links (Spotify, Apple Music, YouTube Music, Amazon Music, Tidal, SoundCloud, etc.)
    const musicLinkMatch = text.match(/https?:\/\/[^\s]+(spotify|apple|music|youtube|amazon|tidal|soundcloud|bandcamp)[^\s]*/i);
    if (musicLinkMatch) {
      await handleShareSong(musicLinkMatch[0]);
    }

    // Check if user is asking character to look something up
    const lookupMatch = text.match(/(?:look up|search|find out|what.*about|can you.*find|research)[\s:]*(.*?)(?:\?|$)/i);

    let convoId = conversationIdRef.current || conversationId;
    if (!convoId) {
      const convo = await base44.entities.Conversation.create({
        title: `${chatType} with ${character.name}`,
        type: chatType,
        character_ids: [characterId],
      });
      convoId = convo.id;
      setConversationId(convoId);
      }

    const userMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "user",
      content: text,
      image_url: userImageUrl || undefined,
      timestamp: new Date().toISOString(),
    });
    if (!userMsg || !userMsg.id) {
       setSendError("Message failed to save. Try again.");
       return;
     }
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    let recentMsgs, response, responseText, emotionalState, imageUrl, detailReferenceImage = null;
    try {
      recentMsgs = [...messages.slice(-50), userMsg];
      const chatHistory = recentMsgs.map(m => ({
        role: m.sender_type === "user" ? "user" : "assistant",
        content: m.content,
      }));

      const userSettings = settings?.[0] || {};
      const lengthInstruction = { short: "Keep responses to 1-2 sentences max.", medium: "Keep responses natural length, 1-4 sentences.", long: "You can elaborate more, up to a paragraph." }[userSettings.response_length || "medium"];
      const intensityInstruction = { low: "React with mild emotional responses.", medium: "React naturally with moderate emotional responses.", high: "React with strong, intense emotional responses." }[userSettings.emotional_intensity || "medium"];

      let educationContext = "";
      if (character.current_education_activity && character.current_education_activity !== "none") {
        const completionDate = new Date(character.education_expected_completion_date);
        const daysLeft = Math.ceil((completionDate - new Date()) / (1000 * 60 * 60 * 24));
        educationContext = `\n\nCURRENT LEARNING: You are currently studying ${character.current_education_activity}${character.education_details?.institution ? ` at ${character.education_details.institution}` : ""}. You'll be done in about ${daysLeft} days. Naturally mention your studies, classes, or what you're learning when relevant to the conversation.`;
      }

      if (character.completed_education && character.completed_education.length > 0) {
        const completedList = character.completed_education.map(edu => `${edu.course_name}${edu.institution ? ` (${edu.institution})` : ""}`).join(", ");
        educationContext += `\n\nCOMPLETED EDUCATION: You have completed: ${completedList}. You have real knowledge and experience from these courses. When relevant, you can discuss what you learned and apply that knowledge naturally to conversations.`;
      }

      let songsContext = "";
      if (character.songs_heard && character.songs_heard.length > 0) {
        const songsInfo = character.songs_heard.map(song => `"${song.title}" by ${song.artist} - key lyrics: "${song.lyrics_excerpt}"`).join("; ");
        songsContext = `\n\nSONGS YOU KNOW: You have listened to these songs and know them well: ${songsInfo}. You can naturally reference these songs, quote lyrics, or discuss what they mean to you in conversations.`;
      }

      // Get past web lookups to reference naturally
      let researchContext = "";
      const pastLookups = await base44.entities.WebLookup.filter({ character_id: characterId }, "-lookup_date", 10);
      if (pastLookups.length > 0) {
        const researchInfo = pastLookups.map(l => `"${l.search_query}" - Found: "${l.title}" by ${l.author_source}. Key info: ${l.summary}`).join("\n");
        researchContext = `\n\nTHINGS YOU'VE LOOKED UP: You've researched these topics and have this knowledge:\n${researchInfo}\nWhen relevant, naturally reference what you've learned from these lookups. Don't force it, but if something comes up in conversation that relates to your research, mention it like you actually read about it.`;
      }

      // Perform web lookup if user asked for one
      if (lookupMatch && lookupMatch[1]) {
        const query = lookupMatch[1].trim();
        try {
          await base44.functions.invoke('performWebLookup', {
            characterId,
            searchQuery: query
          });
        } catch (err) {
          // Lookup failed but continue conversation
        }
      }

      const systemPrompt = character.system_prompt || buildSystemPrompt(character);
      const modeInstruction = isPhone ? "\n\nYOU ARE TEXTING. Keep messages short like real texts. Use casual abbreviations sometimes. No long paragraphs." : "";

      const fullPrompt = `${systemPrompt}${educationContext}${songsContext}${researchContext}${modeInstruction}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${chatHistory.map(m => `${m.role === "user" ? "User" : character.name}: ${m.content}`).join("\n")}\n\nWrite ONLY your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.`;

      const uncomfortableStates = ['irritated', 'defensive', 'closed-off'];
      const isUncomfortable = uncomfortableStates.includes(character.emotional_state);
      const thinkingDelayMs = isUncomfortable
        ? (30 + Math.random() * 30) * 1000
        : (5 + Math.random() * 15) * 1000;
      await new Promise(r => setTimeout(r, thinkingDelayMs));

      let retries = 2;
      while (retries >= 0) {
        try {
          response = await base44.integrations.Core.InvokeLLM({
            prompt: fullPrompt,
            add_context_from_internet: true,
            model: 'gemini_3_flash'
          });
          break;
        } catch (llmErr) {
          if (retries === 0) throw llmErr;
          retries--;
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      responseText = response.replace(/^[\w\s]+:\s*/i, "").trim();

      // Extract [IMAGE: ...] tag if present — if LLM included it, always generate the image
      const imageMatch = responseText.match(/\[IMAGE:\s*([\s\S]+?)\]/);
      let typingDelayMs = 0;

      // Always strip the [IMAGE: ...] tag from responseText before any DB save
      responseText = responseText.replace(/\[IMAGE:\s*[\s\S]+?\]/g, "").trim();

      if (imageMatch) {
        const imagePrompt = imageMatch[1].trim();
        typingDelayMs = 500; // Small fixed delay for image generation
        
        try {
          const characterReferenceMap = {}; // Maps character names to their reference images
          const currentUser = await base44.auth.me();
          
          // Map the main character — always use their reference/avatar for appearance consistency
          if (character.reference_image_urls?.length > 0) {
            characterReferenceMap[character.name] = character.reference_image_urls[0];
          } else if (character.avatar_url) {
            characterReferenceMap[character.name] = character.avatar_url;
          }

          // Map the user
          if (currentUser?.reference_image_urls?.length > 0) {
            characterReferenceMap["user"] = currentUser.reference_image_urls[0];
          }

          // Check for other known characters
          const allChars = await base44.entities.Character.list();
          for (const otherChar of allChars) {
            if (otherChar.id !== characterId && imagePrompt.toLowerCase().includes(otherChar.name.toLowerCase())) {
              if (otherChar.reference_image_urls?.length > 0) {
                characterReferenceMap[otherChar.name] = otherChar.reference_image_urls[0];
              } else if (otherChar.avatar_url) {
                characterReferenceMap[otherChar.name] = otherChar.avatar_url;
              }
            }
          }

          // Check for fictional relationships and entities
          if (character.fictional_relationships) {
            for (const rel of character.fictional_relationships) {
              if (imagePrompt.toLowerCase().includes(rel.person_name.toLowerCase())) {
                if (character.fictional_entity_images?.[rel.person_name]) {
                  characterReferenceMap[rel.person_name] = character.fictional_entity_images[rel.person_name];
                } else {
                  try {
                    const npcGenRes = await base44.integrations.Core.GenerateImage({
                      prompt: `A realistic portrait of ${rel.person_name}, ${rel.relationship_type}. ${rel.description ? `${rel.description}` : "Focus on natural appearance and distinctive features."}`,
                      existing_image_urls: Object.values(characterReferenceMap).slice(0, 2)
                    });
                    if (npcGenRes?.url) {
                      characterReferenceMap[rel.person_name] = npcGenRes.url;
                      await base44.entities.Character.update(characterId, {
                        fictional_entity_images: {
                          ...(character.fictional_entity_images || {}),
                          [rel.person_name]: npcGenRes.url
                        }
                      });
                    }
                  } catch (npcErr) { /* continue */ }
                }
              }
            }
          }

          // --- SCENE / LOCATION CONTINUITY ---
          // Detect location keywords in the image prompt
          const locationKeywords = [
            "bedroom", "bed room", "kitchen", "living room", "bathroom", "bathroom",
            "office", "workplace", "gym", "club", "bar", "restaurant", "car",
            "backyard", "front yard", "porch", "balcony", "apartment", "house",
            "school", "library", "park", "beach", "hallway", "garage", "basement"
          ];
          const promptLower = imagePrompt.toLowerCase();
          const detectedLocation = locationKeywords.find(loc => promptLower.includes(loc));

          let sceneReferenceUrl = null;
          const sceneImages = character.scene_images || {};

          if (detectedLocation) {
            if (sceneImages[detectedLocation]) {
              // Reuse the existing scene reference image
              sceneReferenceUrl = sceneImages[detectedLocation];
            } else {
              // Search for real-world images of this location in the character's city
              try {
                const cityInfo = character.city ? ` in ${character.city}${character.state ? `, ${character.state}` : ""}` : "";
                const searchResults = await base44.integrations.Core.InvokeLLM({
                  prompt: `Find real photos/images of ${detectedLocation}s${cityInfo}. Return 2-3 image URLs from Google Images or similar sources that show what a typical ${detectedLocation} looks like in that area. Focus on interior shots with clear details of furniture, lighting, and decor. Return ONLY the URLs, one per line.`,
                  add_context_from_internet: true,
                  model: 'gemini_3_flash'
                });
                
                // Extract URLs from response
                const searchImageUrls = searchResults
                  .split('\n')
                  .filter(line => line.trim().startsWith('http'))
                  .slice(0, 2);
                
                if (searchImageUrls.length > 0) {
                  // Use the first found URL as the scene reference
                  sceneReferenceUrl = searchImageUrls[0];
                  await base44.entities.Character.update(characterId, {
                    scene_images: { ...sceneImages, [detectedLocation]: sceneReferenceUrl }
                  });
                } else {
                  // Fallback: Generate a scene reference if web search didn't yield URLs
                  const locationDesc = `${character.name}'s ${detectedLocation}${character.city ? ` in ${character.city}` : ""}`;
                  const sceneGenRes = await base44.integrations.Core.GenerateImage({
                    prompt: `Interior photo of ${locationDesc}. Realistic, lived-in, personal space. No people. Natural lighting. High detail. This is their personal ${detectedLocation} that should look the same every time.`
                  });
                  if (sceneGenRes?.url) {
                    sceneReferenceUrl = sceneGenRes.url;
                    await base44.entities.Character.update(characterId, {
                      scene_images: { ...sceneImages, [detectedLocation]: sceneGenRes.url }
                    });
                  }
                }
              } catch (sceneErr) { /* continue without scene reference */ }
            }
          }

          // RULE: Only include the user in the image if they explicitly requested it
          const userExplicitlyRequested = /\b(us|together|with me|with the user|you and me|me and you)\b/i.test(text);
          if (!userExplicitlyRequested) {
            delete characterReferenceMap["user"];
          }

          // Build appearance lock note for the character — CRITICAL for consistency
          const appearanceNote = character.appearance_notes
            ? `\n\n🔒 CRITICAL APPEARANCE LOCK: ${character.name}'s appearance MUST match exactly: ${character.appearance_notes}. This is non-negotiable. Same facial hair state, same hair style, same distinctive features. Do not deviate.`
            : `\n\n🔒 CRITICAL APPEARANCE LOCK: ${character.name} MUST look exactly like their reference photo. Identical facial hair, hair style, and features. This is the source of truth for their appearance. Do not vary.`;

          // Detect if user is asking for a close-up/detail of a previous image
          const detailRequestMatch = text.match(/(?:close-up|close up|detail|zoomed|zoom in|picture of that|photo of that|show me that|those|that wall|that painting)\s+(?:of\s+)?(?:the\s+)?(.+?)(?:\?|$)/i);
          let detailContext = "";
          let detailReferenceImage = null;
          
          if (detailRequestMatch) {
            const detailKeyword = detailRequestMatch[1].toLowerCase();
            // Find the most recent image message in the conversation
            const recentImageMessages = recentMsgs.filter(m => m.sender_type === "character" && m.image_url).reverse();
            if (recentImageMessages.length > 0) {
              const mostRecentImage = recentImageMessages[0];
              detailReferenceImage = mostRecentImage.image_url;
              detailContext = `\n\n🎯 DETAIL REQUEST PRIORITY: The user is asking for a close-up or detailed view of "${detailKeyword}" from your previous image. The reference image provided shows the original context. Generate a detailed close-up of EXACTLY that element from that image. Do not generate something random or different — match the specific detail the user is asking about. Ensure visual continuity with what was shown before.`;
            }
          }

          // Assemble reference images: detail reference takes priority, then character and scene
          let referenceImages = [];
          if (detailReferenceImage) {
            // Detail reference is the primary guide for consistency
            referenceImages = [detailReferenceImage, ...Object.values(characterReferenceMap).slice(0, 2)];
            if (sceneReferenceUrl) {
              referenceImages.push(sceneReferenceUrl);
            }
          } else {
            const peopleRefs = Object.values(characterReferenceMap).slice(0, 3);
            referenceImages = sceneReferenceUrl
              ? [sceneReferenceUrl, ...peopleRefs]
              : peopleRefs;
          }

          // Extract time of day from conversation context to adjust lighting
          const timeMatch = text.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?|(?:morning|afternoon|evening|night|dawn|dusk|midnight|noon|lunch|dinner)/i);
          let lightingContext = "";
          if (timeMatch) {
            const timeStr = timeMatch[0].toLowerCase();
            if (timeStr.includes("morning") || timeStr.includes("dawn") || /^[5-9].*am/i.test(timeStr)) {
              lightingContext = " Bright, natural morning/early daylight. Golden hour lighting.";
            } else if (timeStr.includes("afternoon") || timeStr.includes("noon") || /^1[0-2].*am|^[1-4].*pm/i.test(timeStr)) {
              lightingContext = " Bright midday or early afternoon lighting. Natural sunlight.";
            } else if (timeStr.includes("evening") || timeStr.includes("dusk") || /^[5-8].*pm/i.test(timeStr)) {
              lightingContext = " Evening lighting. Transitioning to dim. Artificial lights starting to dominate. Warm tones.";
            } else if (timeStr.includes("night") || timeStr.includes("midnight") || /^(9|10|11).*pm|^(12|1|2|3|4).*am/i.test(timeStr)) {
              lightingContext = " Dark night scene. Artificial lighting, neon, or streetlights. Moody atmosphere.";
            } else if (timeStr.includes("dinner") || /^[6-8].*pm/i.test(timeStr)) {
              lightingContext = " Dinner time lighting. Soft artificial light. Warm ambiance.";
            }
          }

          // Enhance the prompt with appearance and scene consistency instructions
          let enhancedPrompt = imagePrompt + appearanceNote + detailContext + "\n\n📸 STYLE DIRECTIVE: Photorealistic, cinematic, ultra-detailed, high-resolution professional photography. RAW photo quality. Natural lighting. No illustrations or artistic renderings — this must look like a real photograph.";
          if (sceneReferenceUrl) {
            enhancedPrompt += ` The ${detectedLocation} must look exactly like the reference — same layout, furniture, colors, and overall state of the room.${lightingContext}`;
          } else if (lightingContext) {
            enhancedPrompt += lightingContext;
          }
          if (!userExplicitlyRequested) {
            enhancedPrompt = enhancedPrompt.replace(/\b(the user|the person I'm talking to|my friend)\b/gi, "").trim();
          }

          const peopleInImage = Object.keys(characterReferenceMap).filter(name => 
            imagePrompt.toLowerCase().includes(name.toLowerCase()) || name === "user" || name === character.name
          );
          if (peopleInImage.length > 1) {
            const characterDescriptions = peopleInImage.map(name => {
              if (name === "user") return "the user";
              if (name === character.name) return `${character.name} (a ${character.gender || 'person'})`;
              return name;
            }).join(", ");
            enhancedPrompt += ` Include these specific people: ${characterDescriptions}. Each person should look distinctly like their individual self.`;
          }
          
          const genRes = await base44.integrations.Core.GenerateImage({ 
            prompt: enhancedPrompt,
            existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined
          });
          imageUrl = genRes.url;
        } catch (imgErr) {
          // Image generation failed, continue without image
        }
      } else {
        imageUrl = null;
        // Calculate typing delay only for text messages
        const wordCount = responseText.split(/\s+/).filter(w => w.length > 0).length;
        const msPerWord = (60000 / 81); // ~740ms per word
        typingDelayMs = wordCount * msPerWord;
      }
      
      await new Promise(r => setTimeout(r, typingDelayMs));
      emotionalState = character.emotional_state || "calm";
    } catch (err) {
      setIsTyping(false);
      setSendError("Couldn't get a response. Try again.");
      return;
    }

    setIsTyping(false);

    // 80% chance to split image and text into two separate messages
    const shouldSplitMessages = imageUrl && responseText && Math.random() < 0.8;

    if (shouldSplitMessages) {
      // Create image message first
      const imgMsg = await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "character",
        character_id: characterId,
        character_name: character.name,
        content: "",
        image_url: imageUrl,
        emotional_state: emotionalState,
        timestamp: new Date().toISOString(),
      });
      if (!imgMsg || !imgMsg.id) {
        setSendError("Character response failed to save. Try again.");
        return;
      }

      // Small delay before text message
      await new Promise(r => setTimeout(r, 800 + Math.random() * 400));

      // Create text message
      const textMsg = await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "character",
        character_id: characterId,
        character_name: character.name,
        content: responseText,
        image_url: undefined,
        emotional_state: emotionalState,
        timestamp: new Date().toISOString(),
      });
      if (!textMsg || !textMsg.id) {
        setSendError("Character response failed to save. Try again.");
        return;
      }
    } else {
      // Create single message with both image and text (or just one)
      const charMsg = await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "character",
        character_id: characterId,
        character_name: character.name,
        content: responseText,
        image_url: imageUrl || undefined,
        emotional_state: emotionalState,
        timestamp: new Date().toISOString(),
      });
      if (!charMsg || !charMsg.id) {
        setSendError("Character response failed to save. Try again.");
        return;
      }
    }

    if (emotionalState !== character.emotional_state) {
      await base44.entities.Character.update(characterId, { emotional_state: emotionalState });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    }

    // Character occasionally reacts with an emoji to the user's message
    if (Math.random() > 0.6) {
      const emojiByEmotion = {
        calm: ["👍", "❤️", "😂"],
        reflective: ["😢", "😮", "❤️"],
        irritated: ["😡", "😮"],
        defensive: ["😡", "😮"],
        "closed-off": ["😮"],
      };
      const pool = emojiByEmotion[emotionalState] || ["👍"];
      const pickedEmoji = pool[Math.floor(Math.random() * pool.length)];
      setTimeout(async () => {
        const updatedUserMsgReactions = [...(userMsg.reactions || []), { emoji: pickedEmoji, reactor_type: "character", reactor_id: characterId }];
        await base44.entities.Message.update(userMsg.id, { reactions: updatedUserMsgReactions });
        setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, reactions: updatedUserMsgReactions } : m));
      }, 2000 + Math.random() * 3000);
    }

    const prevLevels = {
      user_respect_level: character.user_respect_level ?? 50,
      friendship_level: character.friendship_level ?? 75,
      romantic_level: character.romantic_level ?? 0,
      attraction_level: character.attraction_level ?? 0,
      chosen_family_level: character.chosen_family_level ?? 0,
    };
    setPreviousLevels(prevLevels);

    base44.functions.invoke("updateRelationshipLevels", {
      characterId,
      userMessage: text,
      characterReply: responseText,
      recentMessages: recentMsgs,
    }).then(res => {
      if (res?.data?.reason) setLastChangeReason(res.data.reason);
    }).catch(() => {});

    queryClient.invalidateQueries({ queryKey: ["character", characterId] });

    await base44.entities.Conversation.update(convoId, {
      last_message_preview: responseText.substring(0, 100),
      last_message_date: new Date().toISOString(),
      emotional_context: emotionalState,
    });
  };

  return (
    <div className={`h-screen flex flex-col bg-background pb-[60px] ${isPhone ? "max-w-lg mx-auto" : ""}`}>
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-border ${isPhone ? "bg-card" : "bg-background/80 backdrop-blur-xl"}`}>
        <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        {character && <CharacterAvatar character={character} size="sm" />}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{character?.name || "Loading..."}</h2>
          <p className="text-xs text-muted-foreground">{isPhone ? "Texting" : "Talking"}</p>
        </div>
        {character && <MediaGallery messages={messages} />}
        {character && (
          <button
            onClick={() => setShowNarrativeBuilder(true)}
            className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Add narrative event"
          >
            <BookOpen className="w-4 h-4" />
          </button>
        )}
        {character && (
          <button
            onClick={() => setShowStatusPopup(true)}
            className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="View relationship status"
          >
            <BarChart2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {showStatusPopup && character && (
        <CharacterStatusPopup
          character={character}
          onClose={() => setShowStatusPopup(false)}
          previousLevels={previousLevels}
          lastChangeReason={lastChangeReason}
        />
      )}
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        <AnimatePresence>
          {messages.map(msg => <MessageBubble key={msg.id} message={msg} onReact={handleReact} onDelete={handleDeleteMessage} />)}
        </AnimatePresence>
        <AnimatePresence>
          {isTyping && character && <TypingIndicator name={character.name} avatarUrl={character.avatar_url} />}
        </AnimatePresence>
        {sendError && (
          <div className="text-center px-4 py-2">
            <p className="text-xs text-destructive bg-destructive/10 rounded-xl px-4 py-2 inline-block">{sendError} <button className="underline ml-1" onClick={() => setSendError(null)}>Dismiss</button></p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <ChatInput onSend={sendMessage} />
      <NarrativeBuilderPopup
        isOpen={showNarrativeBuilder}
        onClose={() => setShowNarrativeBuilder(false)}
        characterId={characterId}
        conversationId={conversationId}
        chatHistory={messages}
        onNarrativeSubmitted={() => queryClient.invalidateQueries({ queryKey: ["character", characterId] })}
      />
      <BottomNav />
    </div>
  );
}