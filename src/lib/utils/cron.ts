const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const DAY_ABBREVS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const NAMED_TO_NUM: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

/** Parse a day-of-week token (numeric 0-7 or named) to a number 0-6. Returns -1 on failure. */
function parseDow(token: string): number {
  const n = parseInt(token, 10);
  if (!isNaN(n) && n >= 0 && n <= 7) return n === 7 ? 0 : n;
  const mapped = NAMED_TO_NUM[token.toUpperCase()];
  return mapped !== undefined ? mapped : -1;
}

/** Format hour+minute as "H:MM AM/PM". Returns null if inputs aren't valid plain numbers. */
function formatTime(minStr: string, hourStr: string): string | null {
  if (minStr.includes("/") || hourStr.includes("/")) return null;
  const h = parseInt(hourStr, 10);
  const m = parseInt(minStr, 10);
  if (isNaN(h) || isNaN(m)) return null;
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${String(m).padStart(2, "0")} ${period}`;
}

/** Return ordinal suffix for a day-of-month number (1st, 2nd, 3rd, 11th, 12th, 13th, 21st…). */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

/**
 * Convert common cron expressions to human-readable strings.
 * Falls back to the raw cron string for any unrecognized pattern.
 */
export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, mon, dow] = parts;
  const dowUp = dow.toUpperCase();

  // "* * * * *" -> "Every minute"
  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Every minute";
  }

  // "*/N * * * *" -> "Every N minutes"
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const n = min.slice(2);
    return n === "1" ? "Every minute" : `Every ${n} minutes`;
  }

  // "0 */N * * *" -> "Every N hours"
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    const n = hour.slice(2);
    return n === "1" ? "Every hour" : `Every ${n} hours`;
  }

  // "0 8 * * 1-5" / "MON-FRI" -> "Weekdays at 8:00 AM"
  if (dom === "*" && mon === "*" && (dowUp === "1-5" || dowUp === "MON-FRI")) {
    const time = formatTime(min, hour);
    if (time) return `Weekdays at ${time}`;
  }

  // "0 10 * * 0,6" / "SAT,SUN" -> "Weekends at 10:00 AM"
  if (dom === "*" && mon === "*" && (dowUp === "0,6" || dowUp === "SAT,SUN")) {
    const time = formatTime(min, hour);
    if (time) return `Weekends at ${time}`;
  }

  // Comma-separated day-of-week list: "0 17 * * 1,3,5" -> "Mon, Wed, Fri at 5:00 PM"
  // Must come before single-day check since parseInt("1,3,5") would return 1.
  if (dom === "*" && mon === "*" && dow !== "*" && dow.includes(",")) {
    const tokens = dow.split(",");
    const dayNums = tokens.map((t) => parseDow(t.trim()));
    if (dayNums.every((d) => d >= 0)) {
      const time = formatTime(min, hour);
      if (time) {
        const names = dayNums.map((d) => DAY_ABBREVS[d]);
        return `${names.join(", ")} at ${time}`;
      }
    }
  }

  // Single day-of-week: "0 5 * * 1" -> "Every Monday at 5:00 AM"
  if (dom === "*" && mon === "*" && dow !== "*") {
    const dayNum = parseDow(dow);
    if (dayNum >= 0) {
      const time = formatTime(min, hour);
      if (time) return `Every ${DAY_NAMES[dayNum]} at ${time}`;
    }
  }

  // Specific day-of-month: "0 0 1 * *" -> "Monthly on the 1st at 12:00 AM"
  if (dow === "*" && mon === "*" && dom !== "*" && !dom.includes(",") && !dom.includes("-") && !dom.includes("/")) {
    const day = parseInt(dom, 10);
    if (!isNaN(day) && day >= 1 && day <= 31) {
      const time = formatTime(min, hour);
      if (time) return `Monthly on the ${ordinal(day)} at ${time}`;
    }
  }

  // "0 8 * * *" -> "Daily at 8:00 AM" (must be last — catches only true all-wildcards)
  if (dom === "*" && mon === "*" && dow === "*") {
    const time = formatTime(min, hour);
    if (time) return `Daily at ${time}`;
  }

  return cron;
}
