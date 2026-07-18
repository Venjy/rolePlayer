import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodError } from "zod";
import { z } from "zod";
import { createConversationInputSchema } from "../../shared/conversation-history";
import { MAX_REALTIME_INSTRUCTIONS_LENGTH } from "../../shared/realtime-protocol";
import {
  ConversationInstructionsTooLongError,
  ConversationRepository,
} from "./conversation-repository";

const idParametersSchema = z.object({
  id: z.string().trim().min(1).max(100),
});

/** Exposes durable conversation creation and read-only history retrieval. */
export function registerConversationRoutes(app: FastifyInstance): void {
  const repository = new ConversationRepository(app.database);

  app.post("/api/conversations", async (request, reply) => {
    const parsed = createConversationInputSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    try {
      return reply.code(201).send(repository.createConversation(parsed.data));
    } catch (error) {
      if (error instanceof ConversationInstructionsTooLongError) {
        return reply.code(400).send({
          message: error.message,
          error: {
            code: "instructions_too_long",
            message: error.message,
            actualLength: error.actualLength,
            maximumLength: MAX_REALTIME_INSTRUCTIONS_LENGTH,
          },
        });
      }
      throw error;
    }
  });

  app.get("/api/conversations", async () => ({
    conversations: repository.listConversations(),
  }));

  app.get("/api/conversations/:id", async (request, reply) => {
    const parsed = idParametersSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const conversation = repository.getConversation(parsed.data.id);
    if (conversation) return conversation;

    const message = `No conversation exists with ID "${parsed.data.id}".`;
    return reply.code(404).send({
      message,
      error: {
        code: "conversation_not_found",
        message,
      },
    });
  });
}

function sendValidationError(reply: FastifyReply, error: ZodError) {
  const message = "The request body or path parameters are invalid.";
  return reply.code(400).send({
    message,
    error: {
      code: "invalid_request",
      message,
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
  });
}
