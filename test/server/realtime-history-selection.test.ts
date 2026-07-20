import { describe, expect, it } from "vitest";
import { selectRealtimeHistory } from "../../src/server/realtime/realtime-gateway";
import { MAX_REALTIME_HISTORY_TURNS } from "../../src/shared/realtime-protocol";

describe("selectRealtimeHistory", () => {
  it("keeps all messages when the stored history is within the turn budget", () => {
    const history = [
      { role: "user" as const, text: "First question" },
      { role: "assistant" as const, text: "First answer" },
    ];

    expect(selectRealtimeHistory(history, 20)).toEqual(history);
  });

  it("starts at the oldest user turn inside the requested recent window", () => {
    const history = [
      { role: "user" as const, text: "Question one" },
      { role: "assistant" as const, text: "Answer one" },
      { role: "user" as const, text: "Question two" },
      { role: "assistant" as const, text: "Interrupted answer" },
      { role: "user" as const, text: "Question three" },
    ];

    expect(selectRealtimeHistory(history, 2)).toEqual(history.slice(2));
  });

  it("bounds restoration to at most two items per requested user turn", () => {
    const history = [
      { role: "assistant" as const, text: "Orphaned leading answer" },
      { role: "user" as const, text: "Question one" },
      { role: "assistant" as const, text: "Superseded answer" },
      { role: "assistant" as const, text: "Latest answer" },
      { role: "user" as const, text: "Question two" },
      { role: "user" as const, text: "Question three" },
      { role: "assistant" as const, text: "Third answer" },
    ];

    expect(selectRealtimeHistory(history, 2)).toEqual([
      { role: "user", text: "Question two" },
      { role: "user", text: "Question three" },
      { role: "assistant", text: "Third answer" },
    ]);
    expect(selectRealtimeHistory(history, 2)).toHaveLength(3);
  });

  it("does not inject assistant text that has no preceding user turn", () => {
    expect(
      selectRealtimeHistory(
        [{ role: "assistant", text: "Orphaned answer" }],
        20,
      ),
    ).toEqual([]);
  });

  it("restores the newest 50 complete turns at the provider limit", () => {
    const history = Array.from({ length: 55 }, (_, index) => {
      const turn = index + 1;
      return [
        { role: "user" as const, text: `Question ${turn}` },
        { role: "assistant" as const, text: `Answer ${turn}` },
      ];
    }).flat();

    const selected = selectRealtimeHistory(
      history,
      MAX_REALTIME_HISTORY_TURNS,
    );

    expect(selected).toHaveLength(MAX_REALTIME_HISTORY_TURNS * 2);
    expect(selected.slice(0, 2)).toEqual([
      { role: "user", text: "Question 6" },
      { role: "assistant", text: "Answer 6" },
    ]);
    expect(selected.slice(-2)).toEqual([
      { role: "user", text: "Question 55" },
      { role: "assistant", text: "Answer 55" },
    ]);
  });
});
