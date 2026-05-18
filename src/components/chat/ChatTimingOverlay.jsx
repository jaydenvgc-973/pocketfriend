/**
 * ChatTimingOverlay
 *
 * Small diagnostic overlay shown in the bottom-right corner of the Chat page.
 * Displays real frontend timing milestones from useChatTimingProof.
 *
 * Only visible when the URL contains ?timing=1
 * Hidden by default so normal users never see it.
 */

import React, { useState } from 'react';

const TARGET_CONNECTED = 3000;
const TARGET_SEND_RESPONSE = 5000;

function ms(val) {
  if (val === null || val === undefined) return '…';
  return `${val}ms`;
}

function Badge({ val, target, label }) {
  if (val === null || val === undefined) {
    return <span className="text-muted-foreground">{label}: …</span>;
  }
  const ok = val < target;
  return (
    <span className={ok ? 'text-emerald-400' : 'text-red-400'}>
      {label}: {val}ms {ok ? '✓' : '✗'}
    </span>
  );
}

export default function ChatTimingOverlay({ timingRecord }) {
  const [expanded, setExpanded] = useState(true);

  // Only show if ?timing=1 in URL
  if (!window.location.search.includes('timing=1')) return null;
  if (!timingRecord) {
    return (
      <div className="fixed bottom-20 right-2 z-50 bg-black/80 text-green-400 text-[10px] font-mono px-2 py-1 rounded-lg pointer-events-none">
        ⏱ Timing: waiting…
      </div>
    );
  }

  const r = timingRecord;

  return (
    <div
      className="fixed bottom-20 right-2 z-50 bg-black/90 text-[10px] font-mono rounded-xl border border-white/10 shadow-xl max-w-[230px]"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2">
        <span className="text-white/50">⏱ TIMING</span>
        <span className="text-white/40">{r.characterName?.split(' ')[0]} · {r.channel_under_test}</span>
        <span className="ml-auto text-white/30">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className="px-2 py-1.5 space-y-0.5">
          <div className="text-white/40">Milestones (from route enter)</div>
          <div className="text-blue-300">auth_ready: {ms(r.auth_ready_ms)}</div>
          <div className="text-blue-300">char_prop_ready: {ms(r.character_prop_ready_ms)}</div>
          <div className="text-blue-300">convo_query_done: {ms(r.conversation_query_done_ms)}</div>
          <div className="text-blue-300">messages_rendered: {ms(r.messages_rendered_ms)}</div>
          <div className="text-blue-300">input_visible: {ms(r.input_visible_ms)}</div>
          <div className="mt-1 text-white/40">Key targets</div>
          <Badge val={r.character_connected_ms} target={TARGET_CONNECTED} label="char_connected" />
          <div />
          <Badge val={r.first_send_allowed_ms} target={TARGET_CONNECTED} label="send_allowed" />
          <div />
          {r.send_to_response_ms !== null && (
            <Badge val={r.send_to_response_ms} target={TARGET_SEND_RESPONSE} label="send→response" />
          )}
          <div className="mt-1 text-white/40">Send path</div>
          <div className={r.input_enabled_before_deep_context ? 'text-emerald-400' : 'text-red-400'}>
            input_before_deep_ctx: {String(r.input_enabled_before_deep_context)}
          </div>
          <div className={r.canonical_prompt_cached ? 'text-emerald-400' : 'text-yellow-400'}>
            canonical_cached: {r.canonical_prompt_cached === null ? '…' : String(r.canonical_prompt_cached)}
          </div>
          {r.send_blocking_stages?.length > 0 && (
            <div className="text-orange-400">
              blocking: {r.send_blocking_stages.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}