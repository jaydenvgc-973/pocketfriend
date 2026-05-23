import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * ImageAuditDisplay
 *
 * Shows image generation diagnostics for proof-based debugging.
 * Displays when message.generation_context.image_generation_audit is present.
 *
 * CRITICAL DIAGNOSTICS SHOWN:
 * - source_path (which generation path was used)
 * - resolved identity (character ID, name, appearance lock status)
 * - prompt analysis (original vs sanitized vs final provider prompt)
 * - outfit context (source, text, whether it was injected)
 * - location context (source, zone, image count)
 * - references (character refs, location refs, user refs counts)
 * - provider interaction (status, rejection reason if failed)
 * - warnings (identity collapse, fallback Caucasian used)
 *
 * ENABLES: Side-by-side comparison of audits from different paths to identify root causes.
 */
export default function ImageAuditDisplay({ audit }) {
  const [expanded, setExpanded] = useState(false);

  if (!audit) return null;

  const hasWarnings = audit.warnings?.identity_collapse_detected || audit.warnings?.fallback_caucasian_used;
  const wasSanitized = audit.prompt_analysis?.prompt_was_sanitized;
  const providerFailed = audit.provider_interaction?.status !== 'success';

  return (
    <div className="mt-3 text-xs border border-slate-600/40 rounded-lg overflow-hidden bg-slate-900/40">
      {/* HEADER — Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2 text-left min-w-0">
          <span className="text-slate-400 font-mono">🔍 Audit</span>
          <span className="text-slate-500">{audit.source_path}</span>
          {hasWarnings && <span className="text-amber-400 font-bold">⚠️ Warnings</span>}
          {wasSanitized && <span className="text-cyan-400">Sanitized</span>}
          {providerFailed && <span className="text-red-400">Provider: {audit.provider_interaction?.status}</span>}
        </div>
        <ChevronDown className={`w-3 h-3 text-slate-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* DETAILED AUDIT — Expandable */}
      {expanded && (
        <div className="px-3 py-2 space-y-2 bg-slate-900/60 border-t border-slate-600/20 max-h-96 overflow-y-auto font-mono text-slate-300">
          {/* IDENTITY */}
          <div>
            <div className="text-slate-400 font-bold mb-1">Identity</div>
            <div className="ml-2 space-y-0.5 text-slate-400">
              <div>char_id: <span className="text-cyan-400">{audit.resolved_identity?.effective_character_id || 'null'}</span></div>
              <div>char_name: <span className="text-cyan-400">{audit.resolved_identity?.character_name || 'null'}</span></div>
              <div>appearance_lock: <span className={audit.resolved_identity?.effective_character_id ? 'text-green-400' : 'text-red-400'}>{audit.resolved_identity?.effective_character_id ? 'present' : 'missing'}</span></div>
            </div>
          </div>

          {/* PROMPT */}
          <div>
            <div className="text-slate-400 font-bold mb-1">Prompt</div>
            <div className="ml-2 space-y-0.5 text-slate-400">
              <div>original_len: {audit.prompt_analysis?.original_prompt_length}</div>
              <div>sanitized: {audit.prompt_analysis?.prompt_was_sanitized ? 'yes' : 'no'}</div>
              {audit.prompt_analysis?.sanitized_prompt && (
                <div className="text-amber-300 text-xs mt-1">sanitized: {audit.prompt_analysis.sanitized_prompt}</div>
              )}
            </div>
          </div>

          {/* OUTFIT */}
          <div>
            <div className="text-slate-400 font-bold mb-1">Outfit</div>
            <div className="ml-2 space-y-0.5 text-slate-400">
              <div>source: <span className="text-cyan-400">{audit.outfit_context?.source || 'none'}</span></div>
              <div>injected: {audit.outfit_context?.injected ? 'yes' : 'no'}</div>
              <div>prompt_clothing_preserved: {audit.outfit_context?.prompt_clothing_preserved ? 'yes' : 'no'}</div>
              {audit.outfit_context?.text && (
                <div className="text-slate-300 text-xs mt-1">"{audit.outfit_context.text}"</div>
              )}
            </div>
          </div>

          {/* LOCATION */}
          <div>
            <div className="text-slate-400 font-bold mb-1">Location</div>
            <div className="ml-2 space-y-0.5 text-slate-400">
              <div>zone: <span className="text-cyan-400">{audit.location_context?.zone_name || 'none'}</span></div>
              <div>zone_images: {audit.location_context?.zone_images_count || 0}</div>
            </div>
          </div>

          {/* REFERENCES */}
          <div>
            <div className="text-slate-400 font-bold mb-1">References</div>
            <div className="ml-2 space-y-0.5 text-slate-400">
              <div>char_refs: {audit.references?.character_refs_count}</div>
              <div>location_refs: {audit.references?.location_refs_count}</div>
              <div>user_refs: {audit.references?.user_refs_count}</div>
            </div>
          </div>

          {/* PROVIDER */}
          <div>
            <div className="text-slate-400 font-bold mb-1">Provider</div>
            <div className="ml-2 space-y-0.5 text-slate-400">
              <div>status: <span className={audit.provider_interaction?.status === 'success' ? 'text-green-400' : 'text-red-400'}>{audit.provider_interaction?.status}</span></div>
              {audit.provider_interaction?.rejection_text && (
                <div className="text-red-300 text-xs mt-1">rejection: {audit.provider_interaction.rejection_text}</div>
              )}
            </div>
          </div>

          {/* WARNINGS */}
          {(audit.warnings?.identity_collapse_detected || audit.warnings?.fallback_caucasian_used) && (
            <div className="border-t border-amber-600/40 pt-2">
              <div className="text-amber-400 font-bold mb-1">⚠️ Warnings</div>
              <div className="ml-2 space-y-0.5 text-amber-300">
                {audit.warnings?.identity_collapse_detected && <div>❌ Identity collapse detected</div>}
                {audit.warnings?.fallback_caucasian_used && <div>❌ Fallback Caucasian used (identity failed)</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}