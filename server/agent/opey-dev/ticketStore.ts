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
        .order('createdAt', { ascending: true })
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
    details?: { prUrl?: string; failureReason?: string; worktreePath?: string }
  ): Promise<void> {
    try {
      const updates: any = { 
        status, 
        updatedAt: new Date().toISOString() 
      };

      if (details?.prUrl) updates.finalPrUrl = details.prUrl;
      if (details?.failureReason) updates.failureReason = details.failureReason;
      if (details?.worktreePath) updates.worktreePath = details.worktreePath;

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
   * For the "Scout" script to drop new work into the queue.
   */
  async createTicket(ticket: Partial<EngineeringTicket>): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('engineering_tickets')
        .insert([{
          ...ticket,
          status: 'created',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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
