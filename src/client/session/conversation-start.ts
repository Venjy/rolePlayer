import type {
  ConversationDetail,
  CreateConversationInput,
} from "../../shared/conversation-history";

export interface ConversationStartDependencies {
  verifyMicrophoneAccess: () => Promise<void>;
  createConversation: (
    input: CreateConversationInput,
  ) => Promise<ConversationDetail>;
}

/**
 * Keeps permission/device failures ahead of durable conversation creation.
 * Activation remains separate because it consumes the returned snapshot.
 */
export async function createConversationAfterMicrophonePreflight(
  input: CreateConversationInput,
  dependencies: ConversationStartDependencies,
): Promise<ConversationDetail> {
  await dependencies.verifyMicrophoneAccess();
  return dependencies.createConversation(input);
}
