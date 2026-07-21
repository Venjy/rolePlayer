import { describe, expect, it, vi } from "vitest";
import type {
  ConversationDetail,
  CreateConversationInput,
} from "../../src/shared/conversation-history";
import { createConversationAfterMicrophonePreflight } from "../../src/client/session/conversation-start";

const input: CreateConversationInput = {
  personaId: 1,
  scenarioId: 2,
  difficulty: "medium",
  locale: "en",
};

describe("conversation start", () => {
  it("does not create a durable conversation when microphone access fails", async () => {
    const permissionError = new DOMException(
      "Permission denied",
      "NotAllowedError",
    );
    const verifyMicrophoneAccess = vi.fn().mockRejectedValue(permissionError);
    const createConversation = vi.fn();

    await expect(
      createConversationAfterMicrophonePreflight(input, {
        verifyMicrophoneAccess,
        createConversation,
      }),
    ).rejects.toBe(permissionError);

    expect(verifyMicrophoneAccess).toHaveBeenCalledOnce();
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("creates the conversation only after microphone access succeeds", async () => {
    const callOrder: string[] = [];
    const conversation = { id: 7 } as ConversationDetail;
    const verifyMicrophoneAccess = vi.fn(async () => {
      callOrder.push("microphone");
    });
    const createConversation = vi.fn(async () => {
      callOrder.push("conversation");
      return conversation;
    });

    await expect(
      createConversationAfterMicrophonePreflight(input, {
        verifyMicrophoneAccess,
        createConversation,
      }),
    ).resolves.toBe(conversation);

    expect(callOrder).toEqual(["microphone", "conversation"]);
    expect(createConversation).toHaveBeenCalledWith(input);
  });
});
