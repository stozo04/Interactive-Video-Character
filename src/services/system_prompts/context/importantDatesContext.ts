export interface ImportantDate {
  label: string;
  dateString: string;
  parsedMonth: number;
  parsedDay: number;
  daysUntil: number;
  isToday: boolean;
  isPassed: boolean;
  daysSincePassed?: number;
}

export interface ImportantDatesContext {
  todayDates: ImportantDate[];
  upcomingDates: ImportantDate[];
  passedDates: ImportantDate[];
}