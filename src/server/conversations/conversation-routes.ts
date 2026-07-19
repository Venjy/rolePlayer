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
import { getFeedbackConfig } from "../config";
import {
  ActiveConversationDeletionError,
  ConversationInstructionsTooLongError,
  ConversationRepository,
} from "./conversation-repository";
import {
  ConversationAudioTooLargeError,
  ConversationAudioUnavailableError,
  createConversationDownload,
} from "./conversation-export";
import {
  FeedbackGenerationError,
  QwenConversationFeedbackGenerator,
  type ConversationFeedbackGenerator,
} from "./conversation-feedback-generator";
import {
  ConversationFeedbackRepository,
  ConversationFeedbackService,
} from "./conversation-feedback-service";

const idParametersSchema = z.object({
  id: z.coerce.number().pipe(databaseIdSchema),
});

const downloadQuerySchema = z.object({
  format: conversationDownloadFormatSchema,
});

export interface ConversationRouteOptions {
  feedbackGenerator?: ConversationFeedbackGenerator;
}

/** Exposes durable conversations, exports, and asynchronous coaching feedback. */
export function registerConversationRoutes(
  app: FastifyInstance,
  options: ConversationRouteOptions = {},
): void {
  const repository = new ConversationRepository(app.conversationDatabase);
  const feedbackRepository = new ConversationFeedbackRepository(
    app.conversationDatabase,
  );
  const feedbackService = new ConversationFeedbackService(
    feedbackRepository,
    options.feedbackGenerator ?? createDefaultFeedbackGenerator(),
    (error) => app.log.error({ error }, "Conversation feedback job failed"),
  );
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

  app.delete("/api/conversations/:id", async (request, reply) => {
    const parsed = idParametersSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const conversation = repository.getConversation(parsed.data.id);
    if (!conversation) return sendConversationNotFound(reply, parsed.data.id);

    try {
      await feedbackService.cancel(conversation.id);
      repository.deleteEndedConversation(conversation.id);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof ActiveConversationDeletionError) {
        return reply.code(409).send({
          message: error.message,
          error: { code: "conversation_not_ended", message: error.message },
        });
      }
      throw error;
    }
  });

  app.post("/api/conversations/:id/end", async (request, reply) => {
    const parsed = idParametersSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const conversation = repository.getConversation(parsed.data.id);
    if (!conversation) return sendConversationNotFound(reply, parsed.data.id);

    const endedConversation = repository.endConversation(conversation.id);
    const feedback = feedbackRepository.ensurePending(endedConversation);
    if (feedback.status === "pending") feedbackService.trigger(conversation.id);
    return reply.code(feedback.status === "completed" ? 200 : 202).send({
      conversation: repository.getConversation(conversation.id),
      feedback: feedbackRepository.require(conversation.id),
    });
  });

  app.get("/api/conversations/:id/feedback", async (request, reply) => {
    const parsed = idParametersSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const conversation = repository.getConversation(parsed.data.id);
    if (!conversation) return sendConversationNotFound(reply, parsed.data.id);
    if (conversation.status !== "ended") {
      const message = "The conversation must end before feedback is available.";
      return reply.code(409).send({
        message,
        error: { code: "conversation_not_ended", message },
      });
    }

    const feedback = feedbackRepository.ensurePending(conversation);
    if (feedback.status === "pending") feedbackService.trigger(conversation.id);
    return {
      conversation: repository.getConversation(conversation.id),
      feedback: feedbackRepository.require(conversation.id),
    };
  });

  app.post("/api/conversations/:id/feedback/retry", async (request, reply) => {
    const parsed = idParametersSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const conversation = repository.getConversation(parsed.data.id);
    if (!conversation) return sendConversationNotFound(reply, parsed.data.id);
    if (conversation.status !== "ended") {
      const message = "The conversation must end before feedback is available.";
      return reply.code(409).send({
        message,
        error: { code: "conversation_not_ended", message },
      });
    }

    const current = feedbackRepository.ensurePending(conversation);
    const feedback = current.status === "failed"
      ? feedbackService.retry(conversation.id)
      : current;
    return reply.code(feedback.status === "completed" ? 200 : 202).send({
      conversation: repository.getConversation(conversation.id),
      feedback,
    });
  });

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

    return sendConversationNotFound(reply, parsed.data.id);
  });

  // Database registration opens SQLite in an earlier onReady hook.
  app.addHook("onReady", async () => {
    feedbackService.resumePending();
  });
  app.addHook("onClose", async () => {
    await feedbackService.close();
  });
}

function createDefaultFeedbackGenerator(): ConversationFeedbackGenerator {
  try {
    return new QwenConversationFeedbackGenerator(getFeedbackConfig());
  } catch {
    return {
      model: "unconfigured",
      generate: async () => {
        throw new FeedbackGenerationError(
          "Configure DASHSCOPE_API_KEY to generate end-of-session feedback.",
          "feedback_configuration_missing",
        );
      },
    };
  }
}

function sendConversationNotFound(reply: FastifyReply, id: number) {
  const message = `No conversation exists with ID "${id}".`;
  return reply.code(404).send({
    message,
    error: { code: "conversation_not_found", message },
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
