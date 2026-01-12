// src/services/lifeEventService.ts
/**
 * Life Event Service
 *
 * Tracks Kayley's recent life events to inform autonomous thoughts.
 */

import { supabase } from "./supabaseClient";

export interface LifeEvent {
  id: string;
  description: string;
  category: string;
  intensity: number;
  createdAt: Date;
}

interface LifeEventRow {
  id: string;
  description: string;
  category: string;
  intensity: number;
  created_at: string;
}

const LIFE_EVENTS_TABLE = "life_events";

export async function getRecentLifeEvents(limit: number = 5): Promise<LifeEvent[]> {
  try {
    const { data, error } = await supabase
      .from(LIFE_EVENTS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[LifeEvents] Error fetching recent events:", error);
      return [];
    }

    return (data as LifeEventRow[]).map((row) => ({
      id: row.id,
      description: row.description,
      category: row.category,
      intensity: row.intensity,
      createdAt: new Date(row.created_at),
    }));
  } catch (error) {
    console.error("[LifeEvents] Unexpected error:", error);
    return [];
  }
}

export async function recordLifeEvent(
  description: string,
  category: string,
  intensity: number = 0.5
): Promise<LifeEvent | null> {
  try {
    const { data, error } = await supabase
      .from(LIFE_EVENTS_TABLE)
      .insert({
        description,
        category,
        intensity,
      })
      .select()
      .single();

    if (error || !data) {
      console.error("[LifeEvents] Error creating life event:", error);
      return null;
    }

    const row = data as LifeEventRow;
    return {
      id: row.id,
      description: row.description,
      category: row.category,
      intensity: row.intensity,
      createdAt: new Date(row.created_at),
    };
  } catch (error) {
    console.error("[LifeEvents] Unexpected error:", error);
    return null;
  }
}
