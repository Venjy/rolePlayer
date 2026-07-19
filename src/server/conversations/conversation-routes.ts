import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodError } from "zod";
import { z } from "zod";
import {
  conversationDownloadFormatSchema,
  createConversationInputSchema,
} from "../../shared/conversation-history";
import { databaseIdSchema } from "../../shared/database-id";
import { MAX_REALTIME_INSTRUCTIONS_LENGTH } from "../../shared/realtime-protocol";
import { CatalogRepository } from "../catalog/catalog-repository";
import {
  ConversationInstructionsTooLongError,
  ConversationRepository,
} from "./conversation-repository";
import {
  ConversationAudioTooLargeError,
  ConversationAudioUnavailableError,
  createConversationDownload,
} from "./conversation-export";

const idParametersSchema = z.object({
  id: z.coerce.number().pipe(databaseIdSchema),
});

const downloadQuerySchema = z.object({
  format: conversationDownloadFormatSchema,
});

/** Exposes durable conversation creation and read-only history retrieval. */
export function registerConversationRoutes(app: FastifyInstance): void {
  const repository = new ConversationRepository(app.conversationDatabase);
  const catalog = new CatalogRepository(app.catalogDatabase);

  app.post("/api/conversations", async (request, reply) => {
    const parsed = createConversationInputSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const persona = catalog.getPersona(parsed.data.personaId);
    const scenario = catalog.getScenario(parsed.data.scenarioId);
    if (!persona || !scenario) {
      const message = !persona
        ? `No persona exists with ID "${parsed.data.personaId}".`
        : `No scenario exists with ID "${parsed.data.scenarioId}".`;
      return reply.code(404).send({
        message,
        error: { code: "catalog_record_not_found", message },
      });
    }
    if (!scenario.allowedPersonaIds.includes(persona.id)) {
      const message = "The persona is not compatible with the selected scenario.";
      return reply.code(400).send({
        message,
        error: { code: "incompatible_catalog_selection", message },
      });
    }

    try {
      return reply.code(201).send(repository.createConversation({
        persona,
        scenario,
        difficulty: parsed.data.difficulty,
        locale: parsed.data.locale,
      }));
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

  app.get("/api/conversations/:id/download", async (request, reply) => {
    const parsedId = idParametersSchema.safeParse(request.params);
    const parsedQuery = downloadQuerySchema.safeParse(request.query);
    if (!parsedId.success) return sendValidationError(reply, parsedId.error);
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);

    const conversation = repository.getConversation(parsedId.data.id);
    if (!conversation) {
      const message = `No conversation exists with ID "${parsedId.data.id}".`;
      return reply.code(404).send({
        message,
        error: { code: "conversation_not_found", message },
      });
    }

    try {
      const download = createConversationDownload(
        conversation,
        repository.listConversationAudioSegments(conversation.id),
        parsedQuery.data.format,
      );
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename="${download.filename}"`,
        )
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .type(download.contentType)
        .send(download.body);
    } catch (error) {
      if (error instanceof ConversationAudioUnavailableError) {
        return reply.code(409).send({
          message: error.message,
          error: { code: "conversation_audio_unavailable", message: error.message },
        });
      }
      if (error instanceof ConversationAudioTooLargeError) {
        return reply.code(413).send({
          message: error.message,
          error: { code: "conversation_audio_too_large", message: error.message },
        });
      }
      throw error;
    }
  });

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
  const message = "The request body, path parameters, or query are invalid.";
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
