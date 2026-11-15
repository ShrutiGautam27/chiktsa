import { describe, expect, it } from "vitest";
import { canonicalTimeZone, cn, formatDate, formatDateTime, greeting, initials, relativeTime, TIMEZONES } from "@/lib/utils";

describe("utils", () => {
  it("builds initials from at most two names", () => {
    expect(initials("Kamla Devi Sharma")).toBe("KD");
    expect(initials("  ravi ")).toBe("R");
    expect(initials("")).toBe("");
  });

  it("merges Tailwind classes so later ones win", () => {
    const hidden = false;
    expect(cn("p-2 text-sm", hidden && "hidden", "p-4")).toBe("text-sm p-4");
  });

  it("shows a dash for missing dates and formats real ones in a given zone", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("2026-01-01T00:30:00Z", "Asia/Kolkata")).toMatch(/2026/);
    expect(formatDateTime("2026-01-01T00:30:00Z", "Asia/Kolkata")).toMatch(/6:00/);
  });

  it("describes times relative to now", () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 3 * 3600_000).toISOString())).toMatch(/3 hours ago/);
    expect(relativeTime(new Date(Date.now() + 2 * 86400_000).toISOString())).toMatch(/in 2 days/);
  });

  it("greets by time of day", () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 0, 1, 14))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 0, 1, 20))).toBe("Good evening");
  });

  it("offers current IANA time-zone names (Asia/Kolkata, not legacy Asia/Calcutta)", () => {
    expect(TIMEZONES).toContain("Asia/Kolkata");
    expect(TIMEZONES).not.toContain("Asia/Calcutta");
    expect(canonicalTimeZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(canonicalTimeZone("Europe/London")).toBe("Europe/London");
  });
});
