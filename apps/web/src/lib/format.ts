// Money and date formatting. Dates from the API are plain YYYY-MM-DD strings.
export function money(amount: number, currency = "USD", cents = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

function parse(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso: string) {
  const d = parse(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function longDate(iso: string) {
  return `${shortDate(iso)} ${parse(iso).getUTCFullYear()}`;
}

// End dates are exclusive (a phase "ends" at midnight), so show the day before.
export function lastDay(isoEnd: string) {
  const d = parse(isoEnd);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function todayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((parse(toIso).getTime() - parse(fromIso).getTime()) / 86_400_000);
}

export function weeksLabel(days: number) {
  if (days % 7 === 0) return days === 7 ? "1 week" : `${days / 7} weeks`;
  return days === 1 ? "1 day" : `${days} days`;
}

export function timeAgo(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : `${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`;
}
