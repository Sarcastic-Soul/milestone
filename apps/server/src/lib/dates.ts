// Dates are plain YYYY-MM-DD strings, done in UTC so time zones never shift a day.
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
