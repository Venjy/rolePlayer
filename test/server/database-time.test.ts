import { describe, expect, it } from "vitest";
import {
  formatDatabaseTimestamp,
  nextDatabaseTimestamp,
  normalizeDatabaseTimestamp,
} from "../../src/server/database/database-time";

describe("database timestamps", () => {
  it("formats instants with an explicit UTC+08:00 offset", () => {
    expect(
      formatDatabaseTimestamp(new Date("2026-07-19T04:05:06.007Z")),
    ).toBe("2026-07-19T12:05:06.007+08:00");
  });

  it("advances monotonically while preserving UTC+08:00", () => {
    expect(
      nextDatabaseTimestamp(
        "2026-07-19T12:05:06.007+08:00",
        Date.parse("2026-07-19T04:05:06.000Z"),
      ),
    ).toBe("2026-07-19T12:05:06.008+08:00");
  });

  it("normalizes UTC input without changing the represented instant", () => {
    expect(normalizeDatabaseTimestamp("2026-07-19T04:05:06.007Z"))
      .toBe("2026-07-19T12:05:06.007+08:00");
  });
});
