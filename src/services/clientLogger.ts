// src/services/clientLogger.ts
//
// Browser-side equivalent of server/runtimeLogger.ts.
// Writes to the same server_runtime_logs Supabase table with source='client'
// so all logs (server + browser) appear in one place.
//
// Usage:
//   import { clientLogger } from './clientLogger';
//   clientLogger.info('Something happened', { detail: 'value' });
//
//   // Scoped logger (prefixes every message with [ScopeName])
//   const log = clientLogger.scoped('EmailService');
//   log.info('Email archived', { messageId: '...' });

import { supabase } from './supabaseClient';

type LogSeverity = 'info' | 'warning' | 'error' | 'critical';

const TABLE_NAME = 'server_runtime_logs';
const LOG_PREFIX = '[ClientLogger]';

// ============================================================
// Scoped logger interface — returned by clientLogger.scoped()
// ============================================================
export interface ScopedLogger {
  info(message: string, details?: Record<string, unknown>): void;
  warning(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
  critical(message: string, details?: Record<string, unknown>): void;
}

// ============================================================
// ClientLogger class
// ============================================================
class ClientLogger {
  // ---- Public API ------------------------------------------------

  info(message: string, details?: Record<string, unknown>): void {
    this.emitLocal('info', message, details);
    void this.write('info', message, details);
  }

  warning(message: string, details?: Record<string, unknown>): void {
    this.emitLocal('warning', message, details);
    void this.write('warning', message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.emitLocal('error', message, details);
    void this.write('error', message, details);
  }

  critical(message: string, details?: Record<string, unknown>): void {
    this.emitLocal('critical', message, details);
    void this.write('critical', message, details);
  }

  /**
   * Returns a logger where every message is automatically prefixed
   * with [ScopeName] — keeps log entries easy to filter in Supabase.
   *
   * Example:
   *   const log = clientLogger.scoped('EmailService');
   *   log.info('Archived email');
   *   // writes "[EmailService] Archived email"
   */
  scoped(scope: string): ScopedLogger {
    return {
      info:     (msg, details) => this.info(`[${scope}] ${msg}`, details),
      warning:  (msg, details) => this.warning(`[${scope}] ${msg}`, details),
      error:    (msg, details) => this.error(`[${scope}] ${msg}`, details),
      critical: (msg, details) => this.critical(`[${scope}] ${msg}`, details),
    };
  }

  // ---- Internals -------------------------------------------------

  private emitLocal(severity: LogSeverity, message: string, details?: Record<string, unknown>): void {
    const payload = {
      severity,
      message,
      details: details ?? {},
      occurredAt: new Date().toISOString(),
    };

    switch (severity) {
      case 'info':     console.log(`${LOG_PREFIX} Info`, payload);  break;
      case 'warning':  console.warn(`${LOG_PREFIX} Warning`, payload); break;
      case 'error':    console.error(`${LOG_PREFIX} Error`, payload); break;
      case 'critical': console.error(`${LOG_PREFIX} Critical`, payload); break;
    }
  }

  private async write(severity: LogSeverity, message: string, details?: Record<string, unknown>): Promise<void> {
    try {
      const { error } = await supabase.from(TABLE_NAME).insert({
        severity,
        message,
        details:     details ?? {},
        source:      'client',
        process_id:  null,           // N/A in browser
        occurred_at: new Date().toISOString(),
      });

      if (error) {
        // Never throw from logger — just warn locally
        console.warn(`${LOG_PREFIX} Failed to write log to Supabase`, { message: error.message });
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Unexpected logging failure`, { err });
    }
  }
}

// Singleton — import this everywhere
export const clientLogger = new ClientLogger();
