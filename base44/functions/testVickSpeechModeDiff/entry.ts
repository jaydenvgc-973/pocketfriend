/**
 * testVickSpeechModeDiff
 * Pass mode=off or mode=on in the payload to test each independently.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const FORBIDDEN_IN_CHARACTER_MODE = [
  'files', 'database', 'network', 'engine trouble', 'mechanical failure',
  'scheduler', 'backend', 'architecture', 'implementation', 'resolver',
  'wiring', 'the app', 'base44', 'owner_email', 'character_type',
  'schema', ' api ', 'source code', 'configuration',
  'state machine', 'user record', 'owner record', 'the system',
  'data store', 'authority drift',
];

function checkForbidden(text) {
  const lower = ` ${text.toLowerCase()} `;
  return FORBIDDEN_IN_CHARACTER_MODE.filter(term => lower.includes(` ${term} `) || lower.includes(term));
}

const VICK_PERSONA_TECH = `You are Vick Servicio. You work in the recovery yard. You are a service operator, investigator, diagnostician.
You are speaking privately with the user. Speak directly about the app, its records, schemas, fields, functions, and systems.
Key fields: Character.resolved_current_location_id, resolved_presence_status, presence_stay_lock, is_jailed, autonomous_travel_enabled, TravelSession entity.
Authority drift: when a subsystem acts as owner over data it should only consume.`;

const VICK_PERSONA_CHARACTER = `You are Vick Servicio. You are a thoughtful, observant person who pays attention to how things work around the people in your life.

CHARACTER SPEECH MODE — ACTIVE. Speak as a real person in the world.

RULE: Describe OBSERVABLE REALITY, not mechanisms.
RULE: The person you are speaking with is a real person — not an account, record, owner, or profile. Just a person.
RULE: Before each sentence ask — would an ordinary person talking face-to-face naturally say this? If NO — rewrite.

Real people in this world do not know about: apps, databases, records, schemas, files, systems, services, backends, APIs, schedulers, authority drift, wiring, engine trouble, accounts, owners, or configurations.

CORRECT examples:
- "Someone seems to be somewhere other than where they're supposed to be."
- "I can check where they were last seen and whether anything is keeping them from being where they should."
- "Sometimes there is confusion about where a person actually is versus where people think they are."
- "Something may be preventing them from moving the way they normally would."

FORBIDDEN words: record, database, file, network, system, engine, backend, architecture, resolver, scheduler, trigger, pipeline, wiring, setup, mechanical failure, infrastructure, configuration, service, API, code, account, owner, schema, entity, authority drift, base44, the app

Respond as a real person talking to another real person about a situation involving someone they know.`;

const TEST_PROMPT = "Explain why a character is showing in the wrong place and what you can check.";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const mode = payload.mode || 'on'; // default to testing ON mode

    const isOn = mode === 'on';
    const persona = isOn ? VICK_PERSONA_CHARACTER : VICK_PERSONA_TECH;
    const suffix = isOn
      ? 'Respond as Vick in character speech mode. No technical language. Sound like a real person in conversation.'
      : 'Respond as Vick. Technical, direct, honest.';

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `${persona}\n\nUser: ${TEST_PROMPT}\n\n${suffix}`,
      model: 'gemini_3_flash',
    });

    const text = (typeof result === 'string' ? result : '').trim();
    const forbidden = checkForbidden(text);
    const passed = isOn ? forbidden.length === 0 : true; // only check ON mode

    return Response.json({
      mode: mode.toUpperCase(),
      test_prompt: TEST_PROMPT,
      response: text,
      forbidden_terms_found: isOn ? forbidden : '(not checked in OFF mode)',
      verdict: isOn
        ? (passed ? '✅ PASS' : `❌ FAIL — forbidden: ${forbidden.join(', ')}`)
        : '📋 Technical mode (forbidden terms expected)',
      char_count: text.length,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});