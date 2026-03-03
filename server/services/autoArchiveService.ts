// server/services/autoArchiveService.ts
//
// Persistent auto-archive rules for email senders.
//
// When a sender's address is in email_auto_archive_rules, gmailPoller skips
// the full announcement + question flow and silently archives their emails,
// sending Steven a brief "auto-archived" notification instead.
//
// Rules are added interactively: after a manual archive via WhatsApp, Kayley
// asks "Want me to always archive from [name]?" — a "yes" here calls
// addAutoArchiveRule().

import { supabaseAdmin as supabase } from './supabaseAdmin';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[AutoArchive]';
const runtimeLog = log.fromContext({ source: 'autoArchiveService', route: 'server/email' });

// ============================================================================
// ADDRESS PARSING
// ============================================================================

/**
 * Extracts the email address from an RFC 2822 "From" header.
 * "Joe Test <joe@example.com>" → "joe@example.com"
 * "joe@example.com"           → "joe@example.com"
 * Always lowercase + trimmed.
 */
export function extractEmailAddress(from: string): string {
  runtimeLog.info('Extracting email address from header', {
    source: 'autoArchiveService',
    hasFrom: !!from,
    fromPreview: from ? from.substring(0, 80) : '',
  });
  const match = from.match(/<([^>]+)>/);
  const normalized = (match ? match[1] : from).toLowerCase().trim();
  runtimeLog.info('Extracted email address', {
    source: 'autoArchiveService',
    normalized,
    matchedBrackets: !!match,
  });
  return normalized;
}

/**
 * Extracts the display name from a "From" header.
 * "Joe Test <joe@example.com>" → "Joe Test"
 * "joe@example.com"           → "joe@example.com" (fallback to address)
 */
export function extractDisplayName(from: string): string {
  runtimeLog.info('Extracting display name from header', {
    source: 'autoArchiveService',
    hasFrom: !!from,
    fromPreview: from ? from.substring(0, 80) : '',
  });
  const match = from.match(/^([^<]+?)\s*</);
  const displayName = match ? match[1].trim() : from.trim();
  runtimeLog.info('Extracted display name', {
    source: 'autoArchiveService',
    displayName,
    matchedBrackets: !!match,
  });
  return displayName;
}

// ============================================================================
// RULE CHECKS
// ============================================================================

/**
 * Returns true if the given email address has an active auto-archive rule.
 * Fails open (returns false) on DB error so emails are never silently lost.
 */
export async function checkAutoArchiveRule(fromAddress: string): Promise<boolean> {
  const normalized = fromAddress.toLowerCase().trim();

  runtimeLog.info('Checking auto-archive rule', {
    source: 'autoArchiveService',
    normalized,
  });

  const { data, error } = await supabase
    .from('email_auto_archive_rules')
    .select('id')
    .eq('sender_email', normalized)
    .maybeSingle();

  if (error) {
    runtimeLog.error('Failed to check auto-archive rule', {
      source: 'autoArchiveService',
      fromAddress: normalized,
      error: error.message,
    });
    return false; // fail open — never silently drop email on DB error
  }

  runtimeLog.info('Auto-archive rule lookup complete', {
    source: 'autoArchiveService',
    normalized,
    found: !!data,
  });
  return !!data;
}

// ============================================================================
// RULE MANAGEMENT
// ============================================================================

/**
 * Adds an auto-archive rule for the given sender.
 * Upserts so duplicate calls are safe.
 * Throws on DB failure so the caller can notify Steven.
 */
export async function addAutoArchiveRule(emailAddress: string, displayName: string): Promise<void> {
  const normalized = emailAddress.toLowerCase().trim();

  runtimeLog.info('Adding auto-archive rule', {
    source: 'autoArchiveService',
    emailAddress: normalized,
    displayName,
  });

  const { error } = await supabase
    .from('email_auto_archive_rules')
    .upsert(
      { sender_email: normalized, display_name: displayName },
      { onConflict: 'sender_email' }
    );

  if (error) {
    runtimeLog.error('Failed to add auto-archive rule', {
      source: 'autoArchiveService',
      emailAddress: normalized,
      error: error.message,
    });
    throw error;
  }

  console.log(`${LOG_PREFIX} ✅ Added auto-archive rule: ${displayName} <${normalized}>`);
  runtimeLog.info('Auto-archive rule added', {
    source: 'autoArchiveService',
    emailAddress: normalized,
    displayName,
  });
}
