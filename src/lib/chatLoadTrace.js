/**
 * chatLoadTrace.js — TEMPORARY INSTRUMENTATION
 *
 * Lightweight runtime trace for Chat/Text open diagnosis.
 * Records every relevant request, query, and event in a rolling buffer.
 *
 * REMOVE AFTER VERIFICATION: delete this file and all imports once the
 * "Too many requests" recovery screen is confirmed absent.
 *
 * Accessible from browser console: window.__chatTrace.dump()
 */

const MAX_ENTRIES = 200;
const _entries = [];
let _sessionStart = Date.now();

function _ts() {
  return `+${Date.now() - _sessionStart}ms`;
}

function _push(entry) {
  _entries.push({ ...entry, ts: _ts(), wall: new Date().toISOString() });
  if (_entries.length > MAX_ENTRIES) _entries.shift();
  // Always console.log so it shows in DevTools immediately
  const icon = entry.status === 'BLOCKED' || entry.status === 'SKIPPED' ? '🚫'
    : entry.status === 'RATE_LIMIT' ? '🔴'
    : entry.status === 'ALLOWED' ? '✅'
    : entry.status === 'DEFERRED' ? '⏳'
    : entry.status === 'EVENT' ? '📡'
    : '📋';
  console.log(
    `[TRACE ${_ts()}] ${icon} ${entry.category} | ${entry.name} | caller=${entry.caller || '?'} | page=${entry.page || '?'} | status=${entry.status || '?'}`,
    entry.detail || ''
  );
}

export function traceReset() {
  _entries.length = 0;
  _sessionStart = Date.now();
  console.log('[TRACE] ══════════════ TRACE RESET ══════════════');
}

/**
 * traceRequest(name, { caller, page, userTriggered, status, detail })
 * status: 'ALLOWED' | 'SKIPPED' | 'BLOCKED' | 'DEFERRED' | 'RATE_LIMIT' | 'ERROR'
 */
export function traceRequest(name, opts = {}) {
  _push({
    category: 'REQUEST',
    name,
    caller: opts.caller || null,
    page: opts.page || null,
    userTriggered: opts.userTriggered ?? false,
    status: opts.status || 'ALLOWED',
    detail: opts.detail || null,
  });
}

/**
 * traceEvent(name, { caller, page, detail })
 */
export function traceEvent(name, opts = {}) {
  _push({
    category: 'EVENT',
    name,
    caller: opts.caller || null,
    page: opts.page || null,
    status: 'EVENT',
    detail: opts.detail || null,
  });
}

/**
 * traceMilestone(name, detail)
 * For Chat mount sequence milestones.
 */
export function traceMilestone(name, detail) {
  _push({
    category: 'MILESTONE',
    name,
    status: 'MILESTONE',
    detail: detail || null,
    page: null,
    caller: null,
  });
  console.log(`[TRACE ${_ts()}] 🏁 MILESTONE: ${name}${detail ? ' — ' + detail : ''}`);
}

/**
 * traceRateLimit(trigger, detail)
 * Called when 429 or rate-limit screen is about to appear.
 */
export function traceRateLimit(trigger, detail) {
  _push({
    category: 'RATE_LIMIT',
    name: trigger,
    status: 'RATE_LIMIT',
    detail: detail || null,
    page: null,
    caller: null,
  });
  console.error(`[TRACE ${_ts()}] 🔴 RATE_LIMIT TRIGGERED by: ${trigger}`, detail || '');
  // Print the last 20 entries as context
  const recent = _entries.slice(-20);
  console.group('[TRACE] Last 20 entries before rate-limit:');
  recent.forEach(e => {
    console.log(`  ${e.ts} | ${e.category} | ${e.name} | status=${e.status} | caller=${e.caller || '?'}`);
  });
  console.groupEnd();
}

// Expose to browser console for manual inspection
if (typeof window !== 'undefined') {
  window.__chatTrace = {
    dump: () => {
      console.group('[TRACE DUMP] Full request log:');
      _entries.forEach((e, i) => {
        console.log(`[${i}] ${e.ts} | ${e.category} | ${e.name} | page=${e.page || '?'} | status=${e.status} | caller=${e.caller || '?'}`, e.detail || '');
      });
      console.groupEnd();
      return _entries;
    },
    recent: (n = 30) => _entries.slice(-n),
    clear: traceReset,
    rateLimits: () => _entries.filter(e => e.category === 'RATE_LIMIT'),
    milestones: () => _entries.filter(e => e.category === 'MILESTONE'),
  };
}