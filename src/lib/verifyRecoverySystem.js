/**
 * Recovery System Verification
 * 
 * Helper to verify that the circuit breaker system is working correctly.
 * Call this in tests or during debugging.
 */

import { RecoveryProofLog } from '@/lib/recoveryProofLogger';

/**
 * Verify that a conversation's recovery system is functioning correctly.
 * 
 * Returns: { passed: boolean, issues: string[] }
 */
export function verifyRecoverySystem(conversationId, ownerEmail) {
  const issues = [];
  const summary = RecoveryProofLog.getSummary(conversationId, ownerEmail);

  // Check: If fallback was detected, recovery should have been triggered
  if (summary.fallback_detected && !summary.automatic_recovery_started) {
    issues.push('Fallback detected but recovery was not started automatically');
  }

  // Check: If fallback was detected, second fallback should have been blocked
  if (summary.fallback_detected && !summary.second_fallback_blocked) {
    issues.push('Fallback detected but second fallback was not blocked');
  }

  // Check: If recovery was started, it should have either completed or have a blocking stage
  if (summary.automatic_recovery_started) {
    if (!summary.recovery_completed) {
      const logs = RecoveryProofLog.getLogs(conversationId, ownerEmail);
      const lastLog = logs[logs.length - 1];
      if (!lastLog?.blocking_stage) {
        issues.push('Recovery started but never completed and no blocking stage recorded');
      }
    }
  }

  // Check: Real character pipeline should be restored if recovery completed
  if (summary.recovery_completed && !summary.real_character_pipeline_restored) {
    issues.push('Recovery completed but character pipeline was not marked as restored');
  }

  return {
    passed: issues.length === 0,
    issues,
    summary,
  };
}

/**
 * Get human-readable summary of recovery state.
 */
export function getRecoveryStatus(conversationId, ownerEmail) {
  const summary = RecoveryProofLog.getSummary(conversationId, ownerEmail);

  const status = {
    fallback_happened: summary.fallback_detected,
    second_fallback_blocked: summary.second_fallback_blocked,
    recovery_started: summary.automatic_recovery_started,
    recovery_successful: summary.recovery_completed,
    character_restored: summary.real_character_pipeline_restored,
    noncritical_systems_paused: summary.noncritical_systems_deferred,
  };

  let statusString = 'Recovery System Status: ';
  
  if (!summary.fallback_detected) {
    statusString += 'OK (no fallback)';
  } else if (summary.recovery_completed) {
    statusString += 'OK (fallback + recovery completed)';
  } else if (summary.automatic_recovery_started) {
    statusString += 'RECOVERING (fallback detected, recovery in progress)';
  } else {
    statusString += 'ERROR (fallback detected but recovery not triggered)';
  }

  return {
    status: statusString,
    details: status,
    logs: RecoveryProofLog.getLogs(conversationId, ownerEmail).slice(-5), // Last 5 logs
  };
}

/**
 * Debug output: what happened in this conversation's recovery system.
 */
export function debugRecoveryHistory(conversationId, ownerEmail) {
  const logs = RecoveryProofLog.getLogs(conversationId, ownerEmail);
  
  return {
    total_events: logs.length,
    timeline: logs.map((log, i) => ({
      event_number: i + 1,
      timestamp: log.timestamp,
      message: log.message,
      ...Object.entries(log)
        .filter(([k]) => k !== 'timestamp' && k !== 'conversationId' && k !== 'ownerEmail' && k !== 'message')
        .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {})
    })),
  };
}