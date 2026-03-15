/**
 * Convert common cron expressions to human-readable strings.
 */
export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, mon, dow] = parts;

  // "0 8 * * *" -> "Daily at 8:00 AM"
  if (dom === "*" && mon === "*" && dow === "*" && !hour.includes("/") && !min.includes("/")) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `Daily at ${displayHour}:${String(m).padStart(2, "0")} ${period}`;
    }
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

  // "0 8 * * 1-5" -> "Weekdays at 8:00 AM"
  if (dom === "*" && mon === "*" && (dow === "1-5" || dow === "MON-FRI") && !hour.includes("/")) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `Weekdays at ${displayHour}:${String(m).padStart(2, "0")} ${period}`;
    }
  }

  return cron;
}
