import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EngineeringTicket, EngineeringTicketStatus } from './types';
import { log } from '../../runtimeLogger';

export class SupabaseTicketStore {
  private supabase: SupabaseClient;

  constructor(url: string, key: string) {
    this.supabase = createClient(url, key);
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

      if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows found"
        log.error("Error fetching next ticket", {
          source: "ticketStore.ts",
          error: error.message,
          code: error.code,
        });
      }
      return data || null;
    } catch (err) {
      
      const message = err instanceof Error ? err.message : "Unknown error";
      const isNetworkError = message.includes('fetch failed') || message.includes('ECONNREFUSED');
      if (isNetworkError) {
        // Don't spam — emit at most once per N minutes
        return null; // treat as "no ticket available"
      }
      log.critical("Failed to fetch next ticket", {
        source: "ticketStore.ts",
        error: message,
      });
      throw err;
    }
  }

  /**
   * Updates the ticket status and handles metadata like PR URLs or errors.
   */
  async updateStatus(
    ticketId: string,
    status: EngineeringTicketStatus,
    details?: { prUrl?: string; failureReason?: string; worktreePath?: string; branch?: string; clarificationQuestions?: string }
  ): Promise<void> {
    try {
      const updates: any = {
        status,
        updated_at: new Date().toISOString()
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
      log.info("Updated ticket status", {
        source: "ticketStore.ts",
        ticketId,
        status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error("Failed to update ticket status", {
        source: "ticketStore.ts",
        ticketId,
        status,
        error: message,
      });
      throw err;
    }
  }

  /**
   * Records a step or lifecycle event that happened during ticket processing.
   * Writes to the engineering_ticket_events table so the UI can show a live
   * activity feed of everything Opey did on a ticket.
   *
   * This method intentionally never throws — event tracking is observability,
   * not critical path. A failed insert should never crash the agent.
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
        log.error("Failed to insert ticket event", {
          source: "ticketStore.ts",
          ticketId,
          eventType,
          error: error.message,
        });
      }
    } catch (err) {
      log.error("Failed to insert ticket event", {
        source: "ticketStore.ts",
        ticketId,
        eventType,
        error: String(err),
      });
    }
  }

  /**
   * For the "Scout" script to drop new work into the queue.
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
      log.info("Created ticket", {
        source: "ticketStore.ts",
        ticketId: ticket.id,
        status: "created",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error("Failed to create ticket", {
        source: "ticketStore.ts",
        error: message,
      });
      throw err;
    }
  }
}
