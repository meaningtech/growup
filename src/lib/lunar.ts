const SYNODIC_DAYS = 29.530588853;
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);
const PRINCIPAL_PHASE_DAYS = 1.85;

export type MoonPhase = 'new' | 'waxing' | 'full' | 'waning';

export type MoonDayRange = {
  startDay: number;
  endDay: number;
};

export function moonAgeDays(date: Date): number {
  const days = (date.getTime() - KNOWN_NEW_MOON_MS) / 86_400_000;
  return ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
}

export function moonPhase(date: Date): MoonPhase {
  const age = moonAgeDays(date);
  if (age < PRINCIPAL_PHASE_DAYS || age > SYNODIC_DAYS - PRINCIPAL_PHASE_DAYS) return 'new';
  if (Math.abs(age - SYNODIC_DAYS / 2) < PRINCIPAL_PHASE_DAYS) return 'full';
  return age < SYNODIC_DAYS / 2 ? 'waxing' : 'waning';
}

export function isWaningMoon(date: Date): boolean {
  return moonAgeDays(date) >= SYNODIC_DAYS / 2;
}

export function waningMoonRanges(year: number, month: number): MoonDayRange[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ranges: MoonDayRange[] = [];
  let start: number | null = null;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const waning = isWaningMoon(new Date(Date.UTC(year, month - 1, day, 12)));
    if (waning && start === null) start = day;
    if (!waning && start !== null) {
      ranges.push({ startDay: start, endDay: day - 1 });
      start = null;
    }
  }
  if (start !== null) ranges.push({ startDay: start, endDay: daysInMonth });
  return ranges;
}

export function utcIsoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function utcNoon(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00.000Z`);
}
