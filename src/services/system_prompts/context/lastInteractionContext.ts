export type AbsenceCategory = "first" | "short" | "medium" | "long";

export interface LastInteractionContext {
  category: AbsenceCategory;
  daysSince: number;
  lastInteractionDate: Date | null;
  guidance: string;
}