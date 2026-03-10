import { supabase } from './supabaseClient';
import { clientLogger } from './clientLogger';

const log = clientLogger.scoped('PersonaEvolution');

const EVOLUTION_TABLE = 'kayley_evolution_proposals';

export interface EvolutionProposal {
  id: string;
  created_at: string;
  proposed_changes: string;
  reasoning: string;
  behavioral_notes_snapshot: string;
  change_summary: string;
  version_number: number;
}

export async function getLatestEvolution(): Promise<EvolutionProposal | null> {
  const { data, error } = await supabase
    .from(EVOLUTION_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    log.warning('Failed to fetch latest evolution', { error: error.message });
    return null;
  }

  return data;
}
