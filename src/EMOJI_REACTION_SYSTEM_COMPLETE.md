# Emoji Reaction System - Complete Implementation

## Status: REJECTED (Previous incomplete implementation) & REBUILT

The previous reaction expansion lacked emotional definitions, usage rules, and behavioral intent. This document defines the complete, emotion-triggered system.

---

## 1. Reaction Definitions & Emotional Meanings

### ❤️ Affection, Love, Comfort, Warmth
**Meaning:** Emotional warmth, care, romantic affection, comfort  
**Use for:**
- Sweet/supportive messages
- Affectionate moments between close characters
- Emotional vulnerability from user/character
- Sympathy at appropriate levels
- General warmth and approval

**Not for:** Neutral statements, humor, basic agreement  
**Trigger strength:** Medium-to-strong  
**Personality weight:** Affectionate (1.3), Compassionate (1.2), Romantic (1.3)

---

### 😂 Humor, Amusement, Playful Reactions
**Meaning:** Laughter, teasing, joy, lightheartedness  
**Use for:**
- Funny jokes or witty comments
- Playful banter and teasing
- Amusing observations
- Lighthearted moments

**Not for:** Serious moments, arguments, sad content  
**Trigger strength:** Medium  
**Personality weight:** Playful (1.3), Sarcastic (1.2), Joker (1.3)

---

### 😮 Shock, Surprise, Disbelief
**Meaning:** Surprise, shock, unexpected revelation, plot twist  
**Use for:**
- Shocking or surprising content
- Unexpected behavior or reveals
- Plot twists
- Surprising announcements

**Not for:** Expected/boring statements, things already known  
**Trigger strength:** Medium-to-strong  
**Personality weight:** Dramatic (1.2), Expressive (1.1), Skeptical (1.0)

---

### 😢 Sadness, Sympathy, Emotional Vulnerability
**Meaning:** Sadness, compassion, sympathy, hurt  
**Use for:**
- Sad or difficult moments
- Someone sharing pain
- Loss or disappointment
- Genuine emotional support

**Not for:** Humor, anger (use 😡), basic disagreement  
**Trigger strength:** Strong  
**Personality weight:** Compassionate (1.3), Empathetic (1.2), Sensitive (1.2)

---

### 😡 Anger, Irritation, Offense
**Meaning:** Anger, serious frustration, offense, strong disapproval  
**Use for:**
- Offensive comments
- Serious disagreements
- Reckless behavior
- Disrespect or violation of values
- Genuine anger triggers

**Not for:** Mild annoyance (use 😒), basic disagreement (use 👎), jokes  
**Trigger strength:** Strong  
**Personality weight:** Volatile (1.3), Hot-tempered (1.2), Principled (1.0)

---

### 👍 Agreement, Support, Approval
**Meaning:** Agreement, support, acknowledgment, basic approval  
**Use for:**
- Statements character agrees with
- Supportive messages
- Plan confirmation
- Simple acknowledgment

**Not for:** Emotional warmth (use ❤️), humor (use 😂), disagreement (use 👎)  
**Trigger strength:** Low-to-medium  
**Personality weight:** Agreeable (1.1), Supportive (1.1), Reserved (1.0)

---

## 2. New Reactions (6 Total Added)

### 🔥 Attraction, Hype, Excitement, Admiration
**Meaning:** Attraction, hype, excitement, confidence, admiration of appearance/style  
**Use for:**
- Attractive or sexy images
- Stylish outfit showcases
- Impressive accomplishments
- Confidence/flex moments
- Energetic exciting content
- Admiration of visual presentation

**Not for:** Sadness, arguments, basic approval (use 👍), sympathy  
**Trigger strength:** Medium-to-strong  
**Personality weight:** Flirty (1.3), Confident (1.2), Attracted (1.3)

---

### 😍 Strong Affection, Romantic Attraction, Admiration
**Meaning:** Strong romantic or emotional attraction, being captivated, deep admiration  
**Use for:**
- Romantic photos or moments
- Sweet/flirty messages
- Affectionate interactions
- Cute behavior
- Strong romantic connection moments
- Deep emotional admiration

**Not for:** Basic approval, friendship-only contexts, non-romantic warmth (use ❤️)  
**Trigger strength:** Strong  
**Personality weight:** Romantic (1.3), Flirty (1.3), Attracted (1.2)

---

### 👎 Disagreement, Disapproval, Bad Idea
**Meaning:** Disagreement, rejection, disapproval, bad idea signal  
**Use for:**
- Suggestions character disagrees with
- Reckless or dangerous behavior
- Offensive comments
- Ideas that won't work
- Strong disappointment
- Rejection signal

**Not for:** Anger (use 😡), annoyance (use 😒), weak disagreement  
**Trigger strength:** Medium-to-strong  
**Personality weight:** Opinionated (1.2), Argumentative (1.1), Principled (1.0)

---

### 😒 Annoyance, Side-Eye, Sarcasm
**Meaning:** Annoyance, eye-roll, sarcasm, unimpressed, mild irritation  
**Use for:**
- Corny or bad jokes
- Mild frustration
- Eye-roll moments
- Awkward/cringe behavior
- Passive annoyance
- Sarcastic responses

**Not for:** Real anger (use 😡), serious disagreement (use 👎), genuinely upsetting content  
**Trigger strength:** Low-to-medium  
**Personality weight:** Sarcastic (1.3), Dry humor (1.2), Unimpressed (1.2), Jaded (1.1)

---

### 😭 Emotional Overwhelm, Laughing Too Hard, Devastation
**Meaning:** Overwhelming emotion (laughing or crying), can't handle intensity, dramatic response  
**Use for:**
- Extremely funny moments
- Emotional overwhelm
- Overwhelmingly sweet content
- Crying from laughter
- Dramatic emotional reactions
- "I can't handle this" intensity

**Not for:** Mild sadness (use 😢), mild humor (use 😂), weak reactions  
**Trigger strength:** Very-strong  
**Personality weight:** Dramatic (1.3), Expressive (1.2), Emotional (1.2), Sensitive (1.1)

---

### 👀 Curiosity, Attention, Interest, Gossip
**Meaning:** Curiosity, watching closely, noticing something interesting/suspicious/flirty/dramatic  
**Use for:**
- Gossip or drama
- Suspicious comments or behavior
- Flirt tension moments
- Dramatic reveals
- Interesting content
- "I'm watching this" moments

**Not for:** Basic agreement (use 👍), emotional responses, weak reactions  
**Trigger strength:** Medium  
**Personality weight:** Curious (1.3), Observant (1.2), Gossip-prone (1.2), Playful (1.1)

---

## 3. Maximum Reactions Per Message Bubble (Critical Rule)

### One Reaction Per Actor Per Message
**Max visible reactions on a single message bubble: 2 total**
- Maximum 1 reaction from user
- Maximum 1 reaction from character

### Replacement Behavior
- If user changes reaction on same message: OLD user reaction → REPLACED by NEW user reaction
- If character changes reaction on same message: OLD character reaction → REPLACED by NEW character reaction
- No stacking, no duplicates from same actor

### Valid Multi-Reaction Scenarios
Characters can still react naturally across DIFFERENT messages:
```
Message A (user) → Character reacts with ❤️
Message B (character) → User reacts with 😂
Message C (user) → Character reacts with 👍
Message D (image) → Character reacts with 🔥
```

Each reaction belongs to different message bubble → VALID

### Invalid Scenarios
- Character reacting multiple times to SAME message bubble: INVALID
- User selecting multiple reactions on SAME message bubble: INVALID
- Stacking reactions from same actor: INVALID

---

## 4. Emotion-Triggered Reaction Logic (Not Quota-Based)

### Core Rule: Reactions Must Be Emotionally Justified
Character reactions are triggered by emotional response strength, NOT arbitrary quotas.

### Invalid Suppression Reasons
❌ "Not allowed yet" (cooldown quotas)  
❌ "Only once per 5 messages"  
❌ "Only once per conversation"  
❌ "Only once per day"  
❌ "Fixed random percentage only"  
❌ "Already reacted earlier in thread"

### Valid Suppression Reasons
✅ Character is asleep/napping  
✅ Character is incarcerated/house arrest  
✅ Character hasn't seen the message yet  
✅ Character is unavailable/incapacitated  
✅ Character already has a reaction to THIS specific message bubble (same-actor rule)

### Emotional Response Tiers
1. **No emotional response** (< 0.3 strength) → NO reaction
2. **Weak emotional response** (0.3-0.5 strength) → 30% chance to react
3. **Medium emotional response** (0.5-0.7 strength) → 60% chance to react
4. **Strong emotional response** (0.7+ strength) → SHOULD react
5. **Very strong emotional response** (0.9+ strength) → MUST react (unless blocked by valid suppression)

### Trigger Strength Factors
- **Message content analysis** (humor, affection, sadness, anger, surprise, curiosity)
- **Image content** (attractive, cute, impressive, funny, stylish)
- **Relationship level** (multiplier: 0.5 to 1.5)
- **Character mood** (happy/excited: 1.2x, sad/depressed: 0.6x, angry: 1.1x)
- **Character personality** (personality-weighted reaction availability)
- **Attraction level** (for romantic/flirty reactions)
- **Message recency** (characters react to current conversation)

---

## 5. Character Personality-Based Reaction Tendencies

### Personality → Preferred Reactions Mapping

| Personality | Preferred Reactions | Avoids |
|------------|-------------------|--------|
| Affectionate | ❤️, 😍, 🔥, 👍 | 😡, 👎 |
| Compassionate | ❤️, 😢, 👍, 😮 | 😒, 👎 |
| Playful | 😂, 🔥, 👀, 😒 | ❤️ (unless flirty) |
| Sarcastic | 😂, 😒, 👀, 😮 | ❤️, 👍 |
| Romantic | 😍, ❤️, 🔥, 😭 | 😡, 👎, 😒 |
| Argumentative | 😡, 👎, 😒, 😮 | ❤️, 😍 |
| Reserved | 👍, ❤️, 😮 | 😂, 🔥, 😍 |
| Stoic | 👍, 😮, 😡 | 😭, 😍, ❤️ |
| Dramatic | 😭, 😮, ❤️, 😡 | 👍, 👎 |
| Confident | 🔥, 👍, 😂, 👎 | ❤️, 😢 |
| Flirty | 🔥, 😍, 👀, 😂 | 😡, 👎 |
| Jaded | 😒, 👎, 😮 | ❤️, 😍, 😭 |
| Earnest | ❤️, 😢, 👍, 😮 | 😒, 😂 |
| Optimistic | ❤️, 😂, 🔥, 👍 | 😡, 😢, 👎 |
| Observant | 👀, 😮, 😒 | 👍 |
| Expressive | 😭, 😂, ❤️, 😍 | 👎, 👍 |

---

## 6. Implementation Files

### Core Libraries
- **`lib/reactionDefinitions.js`** - Complete reaction meanings, usage rules, personality weights
- **`lib/characterReactionEngine.js`** - Emotion-triggered reaction logic (no quotas)

### UI Components
- **`components/chat/MessageReactions.jsx`** - Updated to enforce one-per-actor rule

### Storage Schema
- **Message.reactions** array - Already supports `reactor_type` (user/character) and `reactor_id`
- **One reaction per actor enforced at UI and data layer**

---

## 7. Integration Points

### Chat Pages
- `/pages/Chat.jsx` - Uses MessageReactions component
- `/pages/Text.jsx` - Uses MessageReactions component
- Both enforce one-per-actor rule

### Character Reaction Triggers
Character AI should call `decideCharacterReaction()` when:
- Character reads a new message
- User sends a new image
- Character mood changes
- Relationship level shifts

Function returns emoji or null based on emotional trigger strength.

### Achievements
- Count real reaction events
- Don't count replacements as duplicates
- Track reaction frequency per character naturally (emotion-based, not quota-based)

---

## 8. Reaction Frequency Rules (Nuanced, Not Mechanical)

### Natural Reaction Behavior
Characters react when they have genuine emotions, not on schedule:
- ✅ Laugh at genuinely funny content
- ✅ React positively to romantic moments
- ✅ Show disapproval for bad ideas
- ✅ Express curiosity about gossip
- ✅ Display anger at offensive content

### Factors Influencing Frequency
- Character personality (sarcastic chars react more to sarcasm)
- Relationship level (closer relationships = more reactions)
- Emotional state (happy chars more reactive, sad chars less)
- Current mood (affects sensitivity threshold)
- Attraction level (affects romantic/flirty reactions)
- Message content strength (stronger emotions = higher reaction chance)
- Image content (visual triggers like attractiveness)
- Recent reaction frequency (no mechanical limits, just natural variety)

### NOT Mechanical Limits
❌ Don't use "once every 5 messages" rules  
❌ Don't use fixed daily limits  
❌ Don't use "cooldown then allowed again" patterns  
❌ Don't force reactions to hit quotas

---

## 9. Success Criteria

### Phase 1: Definition Complete
✅ All 12 reactions defined with emotional meanings  
✅ Usage rules documented for each emoji  
✅ Personality weightings established  
✅ One-per-actor rule documented

### Phase 2: UI Implementation
✅ MessageReactions component enforces one-per-actor  
✅ Reactions display with reactor type distinction (user vs character)  
✅ Reaction picker shows all 12 emojis  
✅ Chat and Text pages both functional

### Phase 3: Character AI
✅ Character reaction logic based on emotion triggers, not quotas  
✅ Personality-weighted reaction selection  
✅ Trigger strength calculation functional  
✅ Characters react naturally across different messages over time

### Phase 4: Data Consistency
✅ Reactions stored with actor_type and reactor_id  
✅ One-per-actor enforcement at data layer  
✅ Replacements properly handled (old reaction removed)  
✅ No duplicate storage or stacking

### Phase 5: System-Wide Integration
✅ Achievements count real reaction events  
✅ Image reactions using 🔥, 😍, 👀, ❤️ appropriately  
✅ Different personality types show natural reaction differences  
✅ Reactions feel organic and occasional, not mechanical

---

## 10. Notes

- This system replaces previous incomplete implementation
- Emotion-triggered design means characters may not react to every message (and shouldn't)
- One-per-actor rule prevents stacking while allowing natural multi-message reactions
- Personality weighting ensures variety across different character types
- No artificial quotas or cooldowns - reactions based on genuine emotional response