# Character Awareness System

## Overview

The Character Awareness System keeps characters current on U.S. news, entertainment, regional developments, and topics matching their interests and personality—without forcing current events into every conversation.

## Core Components

### 1. CharacterAwarenessProfile Entity
Tracks what each character should be aware of:
- **home_region**: Where they live (for regional news)
- **tracks_us_news**: Major U.S. news (default: true)
- **tracks_entertainment_news**: Celebrity/entertainment news (default: true)
- **tracks_regional_news**: Local/regional news (default: true)
- **tracks_politics**: Political developments (based on personality)
- **tracks_finance**: Market/business news (based on personality)
- **tracks_sports**: Sports news (based on personality)
- **tracks_music**: Music industry news (based on personality)
- **favorite_celebrities**: List of celebrities they're fans of
- **celebrity_reference_model**: If based on a real person
- **interest_tags**: Additional interests (e.g., 'fashion', 'tech')
- **awareness_priority_level**: low/medium/high
- **cached_awareness_context**: Latest fetched awareness text
- **last_awareness_refresh_at**: When it was last updated

### 2. buildCharacterAwarenessContext Backend Function
Fetches current information for a character based on their profile:
- Calls LLM with web search to get latest news on relevant topics
- Respects character interest tracking flags
- Returns formatted awareness context ready for prompt injection
- Caches result for 1 hour

### 3. useCharacterAwareness Hook
React hook for frontend to fetch/cache awareness:
```javascript
const { awarenessContext, isLoading, error } = useCharacterAwareness(characterId);
```
- Checks for existing cache first (reuses if < 1 hour old)
- Falls back to calling backend if needed
- Silent failure (doesn't break chat if awareness unavailable)

## Integration into Chat

### Manual Integration (for Chat.jsx)

Add awareness context to the LLM prompt:

```javascript
// At the top of Chat component
const awarenessContext = useCharacterAwareness(characterId);

// In the sendMessage function, before calling LLM:
const finalPrompt = `${systemPrompt}${educationContext}${songsContext}${memoryContext}...${awarenessContext.awarenessContext}...`;

// Then call LLM with final prompt
```

### Why This Works

1. **Selective Injection**: Awareness is injected as context, not as a prompt instruction to "talk about current events"
2. **Natural Integration**: Characters know the information but aren't told to reference it constantly
3. **Personality Alignment**: What a character knows is shaped by their interests, not generic news
4. **Realism**: Celebrity fans know relevant celebrity news; political characters know politics; finance characters know markets
5. **Subtlety**: Knowledge is in the background until contextually relevant

## Usage Examples

### Celebrity Fan Example
If a character loves Beyoncé:
- `favorite_celebrities: ["Beyoncé"]`
- Backend fetches current Beyoncé news
- Character may naturally reference it when relevant without sounding robotic

### Politically Engaged Character
If character is politically active:
- `tracks_politics: true`
- Backend fetches major political developments
- Character can have informed reactions to political topics

### Finance-Focused Character
If character is business/money-oriented:
- `tracks_finance: true`
- Backend fetches market/business news
- Character naturally understands financial angles

### Celebrity-Based Character
If character is based on a real person:
- `celebrity_reference_model: "Celebrity Name"`
- Backend keeps character current on that celebrity
- Character won't sound outdated relative to their real-world reference

## Backend Function Details

### buildCharacterAwarenessContext Flow

1. **Fetch Character**: Get character and their interests
2. **Get/Create Profile**: Create default profile if needed
3. **Build Awareness Items** (in priority order):
   - U.S. news (if tracks_us_news)
   - Regional news (if in region and tracks_regional_news)
   - Entertainment news (if tracks_entertainment_news)
   - Celebrity-specific news (for each favorite_celebrity)
   - Celebrity reference news (if based on someone)
   - Political news (if tracks_politics)
   - Finance news (if tracks_finance)
   - Sports news (if tracks_sports)
   - Music industry news (if tracks_music)
4. **Format**: Combine into awareness context string
5. **Cache**: Store in CharacterAwarenessProfile for 1 hour

## Conversation Behavior

### Correct (Natural)
```
User: "What do you think about the election?"
Character: "Yeah, it's pretty crazy right now. I think..."
[Character sounds informed because awareness was injected]
```

### Incorrect (Forced)
```
Character: "By the way, did you hear about the election? Also, Beyoncé dropped a new album..."
[Awareness forced randomly into unrelated conversation]
```

### Best Practice
- Knowledge is present in the character's awareness context
- Character references it naturally when the topic comes up
- No forced news blurts or random current event mentions
- Subtlety over exposition

## Caching Strategy

- **Cache Duration**: 1 hour
- **Check on Each Message**: Before calling LLM, hook checks cache
- **Refresh Automatically**: If > 1 hour old, backend fetches fresh
- **Silent Failure**: If awareness fetch fails, chat continues normally
- **No Constant Updates**: Prevents excessive API calls while keeping awareness reasonably current

## Creating/Updating Profiles

Profiles are auto-created on first chat if they don't exist. To customize:

```javascript
// Create custom awareness profile
await base44.entities.CharacterAwarenessProfile.create({
  character_id: "char_123",
  home_region: "California",
  tracks_politics: true,
  favorite_celebrities: ["Beyoncé", "Taylor Swift"],
  celebrity_reference_model: null,
  interest_tags: ["fashion", "music", "social_justice"],
  awareness_priority_level: "high",
});
```

## Performance Notes

- **LLM Calls**: Each awareness refresh calls 2-7 LLM queries depending on character interests
- **Caching**: Reduces calls dramatically (only refresh every 1 hour max)
- **Non-Blocking**: Awareness fetch is non-blocking; chat works if it fails
- **Scalable**: Each character's awareness is independent

## Future Enhancements

Possible additions:
- Interest-based subreddits or RSS feeds
- Character-specific news sources (sports fan knows team news)
- Regional weather awareness
- Scheduled awareness refreshes (daily/weekly)
- Sentiment analysis on current events
- Character reaction modeling based on personality

## Testing

To test character awareness:
1. Create a character with specific interests
2. Create a CharacterAwarenessProfile for them
3. Call buildCharacterAwarenessContext backend function
4. Verify awareness context is returned and formatted correctly
5. In chat, verify character knowledge aligns with awareness (subtly, not forced)