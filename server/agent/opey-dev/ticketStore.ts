// server/agent/opey-dev/ticketStore.ts
//
// Supabase client for Opey — uses the ANON key, not the service role key.
//
// What this enforces at the database level:
//   - Opey can SELECT, INSERT, UPDATE (same as before)
//   - Opey CANNOT DELETE from brain tables (enforced by the
//     20260306_agent_no_delete_policy.sql migration, not by this code)
//   - Opey has no access to secrets/credentials tables (anon key + RLS)
//
// The service role key (SUPABASE_SERVICE_ROLE_KEY) is intentionally
// NOT used here. Even if Claude Code running inside Opey writes code
// that tries to call ticketStore methods, it operates within anon limits.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EngineeringTicket, EngineeringTicketStatus } from './types';
import { log } from '../../runtimeLogger';

export class SupabaseTicketStore {
  private supabase: SupabaseClient;

  constructor() {
    const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
    const anonKey = process.env.SUPABASE_ANON_KEY ?? '';

    if (!url || !anonKey) {
      log.error('SupabaseTicketStore: missing VITE_SUPABASE_URL / SUPABASE_ANON_KEY', {
        source: 'ticketStore.ts',
      });
    }

    this.supabase = createClient(url, anonKey);
  }

  /**
   * Finds the oldest "created" ticket to work on.
   */
  async getNextTicket(): Promise<EngineeringTicket | null> {
    try {
      const { data, error } = await this.supabase
        .from('engineering_tickets')
        .select('*')
        .eq('status', 'created')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
        log.error('Error fetching next ticket', {
          source: 'ticketStore.ts',
          error: error.message,
          code: error.code,
        });
      }
      return data || null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const isNetworkError = message.includes('fetch failed') || message.includes('ECONNREFUSED');
      if (isNetworkError) return null;
      log.critical('Failed to fetch next ticket', { source: 'ticketStore.ts', error: message });
      throw err;
    }
  }

  /**
   * Updates ticket status and optional metadata fields.
   */
  async updateStatus(
    ticketId: string,
    status: EngineeringTicketStatus,
    details?: { prUrl?: string; failureReason?: string; worktreePath?: string; branch?: string; clarificationQuestions?: string }
  ): Promise<void> {
    try {
      const updates: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      };

      if (details?.prUrl) updates.final_pr_url = details.prUrl;
      if (details?.failureReason) updates.failure_reason = details.failureReason;
      if (details?.worktreePath) updates.worktree_path = details.worktreePath;
      if (details?.branch) updates.worktree_branch = details.branch;
      if (details?.clarificationQuestions) updates.clarification_questions = details.clarificationQuestions;

      const { error } = await this.supabase
        .from('engineering_tickets')
        .update(updates)
        .eq('id', ticketId);

      if (error) throw new Error(`Failed to update ticket ${ticketId}: ${error.message}`);
      log.info('Updated ticket status', { source: 'ticketStore.ts', ticketId, status });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Failed to update ticket status', {
        source: 'ticketStore.ts',
        ticketId,
        status,
        error: message,
      });
      throw err;
    }
  }

  /**
   * Records a lifecycle event for a ticket.
   * Intentionally never throws — event tracking is observability, not critical path.
   */
  async addEvent(
    ticketId: string,
    eventType: string,
    summary: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('engineering_ticket_events')
        .insert({
          id: crypto.randomUUID(),
          ticket_id: ticketId,
          event_type: eventType,
          actor_type: 'opey',
          actor_name: 'Opey',
          summary,
          payload,
        });

      if (error) {
        log.error('Failed to insert ticket event', {
          source: 'ticketStore.ts',
          ticketId,
          eventType,
          error: error.message,
        });
      }
    } catch (err) {
      log.error('Failed to insert ticket event', {
        source: 'ticketStore.ts',
        ticketId,
        eventType,
        error: String(err),
      });
    }
  }

  /**
   * Finds all tickets stuck in "implementing" and marks them failed.
   * Called once at startup — any ticket left in "implementing" means the server
   * crashed mid-run and the Codex process is gone. They'll never self-resolve.
   */
  async failOrphanedTickets(): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('engineering_tickets')
        .select('id')
        .eq('status', 'implementing');

      if (error) {
        log.error('Failed to query orphaned tickets', { source: 'ticketStore.ts', error: error.message });
        return;
      }

      if (!data || data.length === 0) return;

      log.warning(`Found ${data.length} orphaned ticket(s) — marking failed`, { source: 'ticketStore.ts' });

      for (const ticket of data) {
        await this.updateStatus(ticket.id, 'failed', { failureReason: 'Orphaned by server restart' }).catch(() => {});
        await this.addEvent(ticket.id, 'orphaned', 'Server restarted while ticket was implementing — marked failed', {});
      }
    } catch (err) {
      log.error('Failed to clean up orphaned tickets', { source: 'ticketStore.ts', error: String(err) });
    }
  }

  /**
   * Creates a new ticket in the queue (used by the Scout script).
   */
  async createTicket(ticket: Partial<EngineeringTicket>): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('engineering_tickets')
        .insert([{
          ...ticket,
          status: 'created',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }]);

      if (error) throw new Error(`Failed to create ticket: ${error.message}`);
      log.info('Created ticket', { source: 'ticketStore.ts', ticketId: ticket.id, status: 'created' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Failed to create ticket', { source: 'ticketStore.ts', error: message });
      throw err;
    }
  }
}
