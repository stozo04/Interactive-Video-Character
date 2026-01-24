import { supabase } from './supabaseClient';
import { UserFact } from './memoryService';

/**
 * Admin Service
 * 
 * Provides generic and table-specific administrative operations.
 */

const USER_FACTS_TABLE = 'user_facts';
const CHARACTER_FACTS_TABLE = 'character_facts';

export type TableType = 'user_facts' | 'character_facts';

export interface TablePagination {
  page: number;
  pageSize: number;
}

export interface FactFilter {
  category?: string;
  search?: string;
}

/**
 * Fetch facts from a specific table with pagination, filtering, and searching.
 */
export const fetchTableDataAdmin = async (
  tableName: TableType,
  pagination: TablePagination,
  filter: FactFilter
): Promise<{ data: any[]; count: number }> => {
  try {
    const { page, pageSize } = pagination;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from(tableName)
      .select('*', { count: 'exact' });

    if (filter.category && filter.category !== 'all') {
      query = query.eq('category', filter.category);
    }

    if (filter.search) {
      query = query.or(`fact_key.ilike.%${filter.search}%,fact_value.ilike.%${filter.search}%`);
    }

    const { data, count, error } = await query
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    return {
      data: data || [],
      count: count || 0
    };
  } catch (error) {
    console.error(`Error fetching table ${tableName} for admin:`, error);
    return { data: [], count: 0 };
  }
};

/**
 * Update a fact in a specific table.
 */
export const updateFactAdmin = async (
  tableName: TableType,
  id: string,
  updates: any
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from(tableName)
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Error updating fact in ${tableName}:`, error);
    return false;
  }
};

/**
 * Create a new fact in a specific table.
 */
export const createFactAdmin = async (
  tableName: TableType,
  fact: any
): Promise<any | null> => {
  try {
    const payload = {
      ...fact,
      updated_at: new Date().toISOString()
    };

    // For character_facts, we need default character_id
    if (tableName === 'character_facts' && !payload.character_id) {
      payload.character_id = 'kayley';
    }

    const { data, error } = await supabase
      .from(tableName)
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`Error creating fact in ${tableName}:`, error);
    return null;
  }
};

/**
 * Delete a fact from a specific table.
 */
export const deleteFactAdmin = async (tableName: TableType, id: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from(tableName)
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Error deleting fact from ${tableName}:`, error);
    return false;
  }
};
