import { describe, expect, test } from "bun:test";
import { cronToHuman } from "../cron";

describe("cronToHuman", () => {
  // --- Core bug fix ---
  test("single day-of-week numeric", () => {
    expect(cronToHuman("0 5 * * 1")).toBe("Every Monday at 5:00 AM");
    expect(cronToHuman("0 5 * * 0")).toBe("Every Sunday at 5:00 AM");
    expect(cronToHuman("0 12 * * 7")).toBe("Every Sunday at 12:00 PM"); // 7 = Sunday alt
    expect(cronToHuman("0 17 * * 5")).toBe("Every Friday at 5:00 PM");
  });

  test("single day-of-week named (case-insensitive)", () => {
    expect(cronToHuman("0 5 * * MON")).toBe("Every Monday at 5:00 AM");
    expect(cronToHuman("0 5 * * mon")).toBe("Every Monday at 5:00 AM");
    expect(cronToHuman("0 5 * * Mon")).toBe("Every Monday at 5:00 AM");
  });

  // --- Daily ---
  test("daily pattern", () => {
    expect(cronToHuman("0 8 * * *")).toBe("Daily at 8:00 AM");
  });

  test("midnight edge case", () => {
    expect(cronToHuman("0 0 * * *")).toBe("Daily at 12:00 AM");
  });

  test("noon edge case", () => {
    expect(cronToHuman("0 12 * * *")).toBe("Daily at 12:00 PM");
  });

  // --- Interval patterns ---
  test("every N minutes", () => {
    expect(cronToHuman("*/15 * * * *")).toBe("Every 15 minutes");
  });

  test("every 1 minute (singular)", () => {
    expect(cronToHuman("*/1 * * * *")).toBe("Every minute");
  });

  test("every N hours", () => {
    expect(cronToHuman("0 */2 * * *")).toBe("Every 2 hours");
  });

  test("every 1 hour (singular)", () => {
    expect(cronToHuman("0 */1 * * *")).toBe("Every hour");
  });

  // --- Weekdays ---
  test("weekdays numeric range", () => {
    expect(cronToHuman("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM");
  });

  test("weekdays named uppercase", () => {
    expect(cronToHuman("0 9 * * MON-FRI")).toBe("Weekdays at 9:00 AM");
  });

  test("weekdays named lowercase", () => {
    expect(cronToHuman("0 9 * * mon-fri")).toBe("Weekdays at 9:00 AM");
  });

  // --- Weekends ---
  test("weekends numeric", () => {
    expect(cronToHuman("0 10 * * 0,6")).toBe("Weekends at 10:00 AM");
  });

  test("weekends named", () => {
    expect(cronToHuman("0 10 * * SAT,SUN")).toBe("Weekends at 10:00 AM");
  });

  // --- Multi-day list ---
  test("comma-separated day list", () => {
    expect(cronToHuman("0 17 * * 1,3,5")).toBe("Mon, Wed, Fri at 5:00 PM");
  });

  // --- Monthly ---
  test("monthly on 1st", () => {
    expect(cronToHuman("0 0 1 * *")).toBe("Monthly on the 1st at 12:00 AM");
  });

  test("monthly on 15th", () => {
    expect(cronToHuman("30 14 15 * *")).toBe("Monthly on the 15th at 2:30 PM");
  });

  test("monthly ordinal 2nd", () => {
    expect(cronToHuman("0 8 2 * *")).toBe("Monthly on the 2nd at 8:00 AM");
  });

  test("monthly ordinal 3rd", () => {
    expect(cronToHuman("0 8 3 * *")).toBe("Monthly on the 3rd at 8:00 AM");
  });

  test("monthly ordinal 11th (not 11st)", () => {
    expect(cronToHuman("0 8 11 * *")).toBe("Monthly on the 11th at 8:00 AM");
  });

  test("monthly ordinal 12th (not 12nd)", () => {
    expect(cronToHuman("0 8 12 * *")).toBe("Monthly on the 12th at 8:00 AM");
  });

  test("monthly ordinal 13th (not 13rd)", () => {
    expect(cronToHuman("0 8 13 * *")).toBe("Monthly on the 13th at 8:00 AM");
  });

  test("monthly ordinal 21st", () => {
    expect(cronToHuman("0 8 21 * *")).toBe("Monthly on the 21st at 8:00 AM");
  });

  // --- Negative tests: should fall through to raw string ---
  test("combined dom+dow falls through", () => {
    expect(cronToHuman("0 5 15 * 1")).toBe("0 5 15 * 1");
  });

  test("specific month+dow falls through", () => {
    expect(cronToHuman("0 5 * 6 1")).toBe("0 5 * 6 1");
  });

  test("specific month only falls through", () => {
    expect(cronToHuman("0 5 * 6 *")).toBe("0 5 * 6 *");
  });

  test("dom range falls through", () => {
    expect(cronToHuman("0 8 1-15 * *")).toBe("0 8 1-15 * *");
  });

  test("dom list falls through", () => {
    expect(cronToHuman("0 8 1,15 * *")).toBe("0 8 1,15 * *");
  });

  test("malformed input falls through", () => {
    expect(cronToHuman("invalid")).toBe("invalid");
  });

  // --- All wildcards ---
  test("all wildcards means every minute", () => {
    expect(cronToHuman("* * * * *")).toBe("Every minute");
  });
});
