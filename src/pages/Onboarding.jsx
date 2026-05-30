import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_CHARACTER_DATA, buildSystemPrompt } from "@/lib/defaultCharacter";
import { Loader2 } from "lucide-react";

const BG_IMAGE = "https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/162a4b6d0_file_00000000e46471fb9edd54ccd1916ae3.png";

/**
 * Onboarding / App Readiness Screen
 *
 * Two distinct states handled here:
 *   1. First-time user (onboardingComplete = false, no characters) → show character creation flow
 *   2. Returning user → show readiness loading screen, preload Home foundation, then route to Home
 *
 * PRELOAD CONTRACT:
 * Uses the SAME React Query cache keys as Home so that when the user enters Home,
 * all foundation data is already in cache and Home renders instantly.
 *
 * Keys warmed here (must match Home exactly):
 *   ["user"]                              → auth.me()
 *   ["userSettings", email]              → UserSettings.filter({ owner_email: email })
 *   ["characters", email]                → Character.filter({ owner_email: email })
 *
 * NOT preloaded here (page-specific, not Home foundation):
 *   - scene data, media gallery, chat histories, travel deep data
 *   - AI calls, maintenance/repair jobs, diagnostics, enrichment
 */
export default function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [characterName, setCharacterName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Readiness state — tracks whether Home foundation has been preloaded
  const [homeReady, setHomeReady] = useState(false);
  const [readinessError, setReadinessError] = useState(false);

  // Account classification state
  const [isTrulyEmptyAccount, setIsTrulyEmptyAccount] = useState(false);
  const [isCheckingAccount, setIsCheckingAccount] = useState(true);

  // Rotating atmospheric loading phrases
  const loadingPhrases = [
    "Getting your world ready…",
    "Preparing your characters…",
    "Loading your world…",
    "Syncing conversations…",
    "Almost ready…",
  ];
  const [phraseIndex, setPhraseIndex] = useState(0);

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Rotate phrases while loading
  useEffect(() => {
    if (!isCheckingAccount) return;
    const interval = setInterval(() => {
      setPhraseIndex(i => (i + 1) % loadingPhrases.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isCheckingAccount]);

  /**
   * PRELOAD HOME FOUNDATION
   *
   * Fires once when currentUser is available.
   * Populates exactly the cache keys Home reads on mount.
   * No AI calls. No maintenance. No page-specific work.
   *
   * Two outcomes:
   *   A. Empty account → setIsTrulyEmptyAccount(true) → show onboarding flow
   *   B. Returning user → data is in cache → setHomeReady(true) → show "Enter" button
   */
  useEffect(() => {
    if (!currentUser?.email) return;

    const preloadHomeFoundation = async () => {
      setIsCheckingAccount(true);
      setReadinessError(false);

      try {
        const email = currentUser.email;

        // STEP 1: Warm UserSettings cache (same key as Home's useUserSettings hook)
        // useUserSettings uses queryKey: ["userSettings", email]
        let settings = queryClient.getQueryData(["userSettings", email]);
        if (!settings) {
          const settingsList = await base44.entities.UserSettings.filter({ owner_email: email });
          const settingsObj = settingsList[0] || null;
          // Store as the object shape that useUserSettings expects
          queryClient.setQueryData(["userSettings", email], settingsObj);
          settings = settingsObj;
        }

        // STEP 2: Warm Characters cache (same key as useOwnedCharacters)
        // useOwnedCharacters uses queryKey: ["characters", email]
        let characters = queryClient.getQueryData(["characters", email]);
        if (!Array.isArray(characters)) {
          characters = await base44.entities.Character.filter(
            { owner_email: email },
            null,
            300
          );
          queryClient.setQueryData(["characters", email], characters);
        }

        // STEP 3: Classify account — onboarding needed or returning user?
        const qualifying = (characters || []).filter(c =>
          c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged' &&
          (
            c.character_type === "active_created_character" ||
            c.character_type === "npc_fictitious" ||
            c.character_type === "NPC_fictitious"
          )
        );

        if (qualifying.length === 0) {
          // Empty account — show onboarding
          setIsTrulyEmptyAccount(true);
          setHomeReady(false);
        } else {
          // Returning user — Home foundation is warmed, mark readiness done for this session
          setIsTrulyEmptyAccount(false);
          setHomeReady(true);
          sessionStorage.setItem("home_readiness_complete", "1");
        }
      } catch (err) {
        console.error("[Onboarding] Preload failed:", err?.message);
        // On failure: surface error, offer direct entry to Home
        // NEVER treat a failed query as an empty account
        setReadinessError(true);
        setIsTrulyEmptyAccount(false);
        setHomeReady(false);
      } finally {
        setIsCheckingAccount(false);
      }
    };

    preloadHomeFoundation();
  }, [currentUser?.email]);

  const handleCreate = async () => {
    if (!characterName.trim()) return;
    setIsSubmitting(true);

    const generated = await base44.integrations.Core.InvokeLLM({
      prompt: `Create a fully realized fictional character named "${characterName.trim()}" for a social simulation app. This character will text and chat with the user — they must feel like a real human being.

Generate a diverse, interesting character. Vary:
- Gender (can be male, female, non-binary — pick what fits the name)
- Age (20s–40s)
- Ethnicity/background (pick something authentic and specific)
- Personality (complex, flawed, real — not generic)
- Communication style (how they actually text — terse? wordy? sarcastic? warm?)
- Emotional state and triggers
- Life situation

CRITICAL: Make this character feel unique. Avoid clichés. Give them a real backstory, real flaws, real relationships.

Return JSON matching this schema exactly:
{
  "gender": "male|female|non-binary|other",
  "age_range": "e.g. Mid 20s",
  "ethnicities": ["e.g. Nigerian", "Puerto Rican"],
  "city": "city name",
  "state": "state abbreviation or country",
  "archetype": "e.g. The Realist, The Dreamer, The Protector",
  "social_energy": "introvert|mostly_introvert|ambivert|mostly_extrovert|extrovert",
  "sexual_orientation": "e.g. Straight, Gay, Bisexual, Queer",
  "personality_summary": "2-3 sentence raw, real description of who they are",
  "personality_traits": ["trait1", "trait2", "trait3", "trait4", "trait5"],
  "communication_style": "how they text and talk — raw, specific, not generic",
  "background_story": "2-3 sentence backstory — specific, real, grounded",
  "current_situation": "what their life looks like right now",
  "family_history": "brief family context — who raised them, key dynamics",
  "loyalty_view": "how they see loyalty",
  "upset_reaction": "how they react when upset",
  "emotional_baggage": "what they carry emotionally",
  "emotional_triggers_high": ["trigger1", "trigger2", "trigger3"],
  "emotional_triggers_medium": ["trigger1", "trigger2"],
  "emotional_triggers_deep": ["trigger1", "trigger2"],
  "work_details": { "job_title": "...", "workplace_type": "...", "work_environment": "..." },
  "lives_alone": true,
  "sleep_start_time": "23:00",
  "wake_up_time": "07:30",
  "work_start_time": "09:00",
  "work_end_time": "17:00",
  "work_days": [1,2,3,4,5]
}`,
      response_json_schema: {
        type: "object",
        properties: {
          gender: { type: "string" },
          age_range: { type: "string" },
          ethnicities: { type: "array", items: { type: "string" } },
          city: { type: "string" },
          state: { type: "string" },
          archetype: { type: "string" },
          social_energy: { type: "string" },
          sexual_orientation: { type: "string" },
          personality_summary: { type: "string" },
          personality_traits: { type: "array", items: { type: "string" } },
          communication_style: { type: "string" },
          background_story: { type: "string" },
          current_situation: { type: "string" },
          family_history: { type: "string" },
          loyalty_view: { type: "string" },
          upset_reaction: { type: "string" },
          emotional_baggage: { type: "string" },
          emotional_triggers_high: { type: "array", items: { type: "string" } },
          emotional_triggers_medium: { type: "array", items: { type: "string" } },
          emotional_triggers_deep: { type: "array", items: { type: "string" } },
          work_details: { type: "object" },
          lives_alone: { type: "boolean" },
          sleep_start_time: { type: "string" },
          wake_up_time: { type: "string" },
          work_start_time: { type: "string" },
          work_end_time: { type: "string" },
          work_days: { type: "array", items: { type: "integer" } }
        }
      }
    });

    const data = {
      ...generated,
      name: characterName.trim(),
      is_default: true,
      is_finalized: true,
      status: "active",
      character_type: "active_created_character",
      emotional_state: "calm",
      user_respect_level: 50,
      friendship_level: 75,
      romantic_level: 0,
      attraction_level: 0,
      chosen_family_level: 100,
      owner_email: currentUser?.email,
    };

    const promptText = buildSystemPrompt(data);
    const { file_url } = await base44.integrations.Core.UploadFile({
      file: new File([promptText], "system_prompt.txt", { type: "text/plain" })
    });
    data.system_prompt_url = file_url;

    const newChar = await base44.entities.Character.create(data);

    // Warm characters cache with the new character so Home doesn't need to re-fetch
    if (currentUser?.email) {
      const existing = queryClient.getQueryData(["characters", currentUser.email]);
      if (Array.isArray(existing)) {
        queryClient.setQueryData(["characters", currentUser.email], [...existing, newChar]);
      }
    }

    const existingSettingsId = queryClient.getQueryData(["userSettings", currentUser?.email])?.id;
    if (existingSettingsId) {
      await base44.entities.UserSettings.update(existingSettingsId, { has_completed_onboarding: true });
    } else {
      await base44.entities.UserSettings.create({
        has_completed_onboarding: true,
        owner_email: currentUser?.email,
      });
    }
    navigate("/home");
  };

  const isLoading = isCheckingAccount || !currentUser;

  return (
    <div
      className="min-h-screen flex items-end justify-center relative overflow-hidden"
      style={{
        backgroundImage: `url(${BG_IMAGE})`,
        backgroundSize: "cover",
        backgroundPosition: "center top",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* Dark gradient overlay at bottom for legibility */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

      {/* Content panel pinned to bottom */}
      <div className="relative z-10 w-full max-w-sm px-6 pb-16 pt-8">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="text-center space-y-5"
            >
              {/* Logo / brand */}
              <div className="space-y-2">
                <h1 className="text-3xl font-bold text-white tracking-tight">Pocketfriend</h1>
                <p className="text-white/70 text-sm leading-relaxed">
                  A character that feels real.<br />Built to push back, not just agree.
                </p>
              </div>

              {/* ── State: Loading / preloading Home foundation ── */}
              {isLoading && (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-full h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 text-white/60 animate-spin" />
                    <motion.span
                      key={phraseIndex}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.6 }}
                      className="text-white/60 text-sm"
                    >
                      {loadingPhrases[phraseIndex]}
                    </motion.span>
                  </div>
                  <Link to="/home" className="text-xs text-white/40 hover:text-white/70 transition-colors">
                    Go to homepage →
                  </Link>
                </div>
              )}

              {/* ── State: Readiness check failed ── */}
              {!isLoading && readinessError && (
                <div className="flex flex-col items-center gap-3">
                  <Link
                    to="/home"
                    className="block w-full h-12 rounded-xl bg-white text-center font-semibold text-base leading-[48px] text-gray-900 hover:bg-white/90 transition-colors shadow-lg"
                  >
                    Go to homepage →
                  </Link>
                  <p className="text-xs text-white/50">Having trouble loading? Tap above to continue.</p>
                </div>
              )}

              {/* ── State: Returning user — Home is preloaded and ready ── */}
              {!isLoading && !readinessError && homeReady && (
                <div className="space-y-3">
                  <Link
                    to="/home"
                    className="block w-full h-12 rounded-xl bg-primary text-center font-semibold text-base leading-[48px] text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/30"
                  >
                    Enter →
                  </Link>
                  <p className="text-xs text-white/40 text-center">Your world is ready</p>
                </div>
              )}

              {/* ── State: Empty account — first-time onboarding ── */}
              {!isLoading && !readinessError && isTrulyEmptyAccount && (
                <div className="space-y-3">
                  <Button
                    onClick={() => setStep(1)}
                    className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-base shadow-lg shadow-primary/30"
                  >
                    Get started
                  </Button>
                  <Link to="/home" className="block text-center text-xs text-white/40 hover:text-white/70 transition-colors">
                    Go to homepage →
                  </Link>
                </div>
              )}
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="name"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="space-y-5"
            >
              <div>
                <h2 className="text-xl font-bold text-white">Name your character</h2>
                <p className="text-white/60 text-sm mt-1">What do you want to call them?</p>
              </div>
              <Input
                value={characterName}
                onChange={e => setCharacterName(e.target.value)}
                placeholder="e.g. Kelvin"
                className="h-12 rounded-xl text-base bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-primary"
                onKeyDown={e => e.key === "Enter" && characterName.trim() && handleCreate()}
              />
              <Button
                onClick={handleCreate}
                disabled={!characterName.trim() || isSubmitting}
                className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold shadow-lg shadow-primary/30"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Building your character…
                  </span>
                ) : (
                  "Create character"
                )}
              </Button>
              <button
                onClick={() => setStep(0)}
                className="w-full text-center text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                ← Back
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}