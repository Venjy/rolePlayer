import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodError } from "zod";
import { z } from "zod";
import { databaseIdSchema } from "../../shared/database-id";
import {
  personaInputSchema,
  scenarioInputSchema,
} from "../../shared/role-play-catalog";
import { MAX_REALTIME_INSTRUCTIONS_LENGTH } from "../../shared/realtime-protocol";
import { PresetReferenceResolutionError } from "../../shared/role-play-preset-resolution";
import {
  CatalogNameConflictError,
  CatalogRepository,
  MissingPersonaReferencesError,
  PersonaInUseError,
  RolePlayInstructionsTooLongError,
} from "./catalog-repository";

const idParametersSchema = z.object({
  id: z.coerce.number().pipe(databaseIdSchema),
});

/** Registers the server-owned CRUD boundary for editable personas and scenarios. */
export function registerCatalogRoutes(app: FastifyInstance): void {
  const repository = new CatalogRepository(app.catalogDatabase);

  app.get("/api/catalog", async () => repository.listCatalog());

  app.post("/api/personas", async (request, reply) => {
    const parsed = personaInputSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    try {
      return reply.code(201).send(repository.createPersona(parsed.data));
    } catch (error) {
      return handleCatalogError(error, reply);
    }
  });

  app.put("/api/personas/:id", async (request, reply) => {
    const parsedParameters = idParametersSchema.safeParse(request.params);
    if (!parsedParameters.success) {
      return sendValidationError(reply, parsedParameters.error);
    }
    const parsedBody = personaInputSchema.safeParse(request.body);
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);

    try {
      const persona = repository.updatePersona(
        parsedParameters.data.id,
        parsedBody.data,
      );
      if (!persona) {
        return sendNotFound(reply, "persona", parsedParameters.data.id);
      }
      return persona;
    } catch (error) {
      return handleCatalogError(error, reply);
    }
  });

  app.delete("/api/personas/:id", async (request, reply) => {
    const parsed = idParametersSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    try {
      if (!repository.deletePersona(parsed.data.id)) {
        return sendNotFound(reply, "persona", parsed.data.id);
      }
      return reply.code(204).send();
    } catch (error) {
      return handleCatalogError(error, reply);
    }
  });

  app.post("/api/scenarios", async (request, reply) => {
    const parsed = scenarioInputSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    try {
      return reply.code(201).send(repository.createScenario(parsed.data));
    } catch (error) {
      return handleCatalogError(error, reply);
    }
  });

  app.put("/api/scenarios/:id", async (request, reply) => {
    const parsedParameters = idParametersSchema.safeParse(request.params);
    if (!parsedParameters.success) {
      return sendValidationError(reply, parsedParameters.error);
    }
    const parsedBody = scenarioInputSchema.safeParse(request.body);
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);

    try {
      const scenario = repository.updateScenario(
        parsedParameters.data.id,
        parsedBody.data,
      );
      if (!scenario) {
        return sendNotFound(reply, "scenario", parsedParameters.data.id);
      }
      return scenario;
    } catch (error) {
      return handleCatalogError(error, reply);
    }
  });

  app.delete("/api/scenarios/:id", async (request, reply) => {
    const parsed = idParametersSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    if (!repository.deleteScenario(parsed.data.id)) {
      return sendNotFound(reply, "scenario", parsed.data.id);
    }
    return reply.code(204).send();
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

function sendNotFound(
  reply: FastifyReply,
  entity: "persona" | "scenario",
  id: number,
) {
  const message = `No ${entity} exists with ID "${id}".`;
  return reply.code(404).send({
    message,
    error: {
      code: `${entity}_not_found`,
      message,
    },
  });
}

function handleCatalogError(error: unknown, reply: FastifyReply) {
  if (error instanceof CatalogNameConflictError) {
    return reply.code(409).send({
      message: error.message,
      error: {
        code: "duplicate_name",
        message: error.message,
        entity: error.entity,
        name: error.conflictingName,
      },
    });
  }

  if (error instanceof MissingPersonaReferencesError) {
    return reply.code(400).send({
      message: error.message,
      error: {
        code: "unknown_persona_reference",
        message: error.message,
        personaIds: error.personaIds,
      },
    });
  }

  if (error instanceof PresetReferenceResolutionError) {
    return reply.code(400).send({
      message: error.message,
      error: {
        code: "unknown_preset_reference",
        message: error.message,
        category: error.category,
        presetId: error.presetId,
      },
    });
  }

  if (error instanceof PersonaInUseError) {
    return reply.code(409).send({
      message: error.message,
      error: {
        code: "persona_in_use",
        message: error.message,
        personaId: error.personaId,
        scenarioIds: error.scenarioIds,
      },
    });
  }

  if (error instanceof RolePlayInstructionsTooLongError) {
    return reply.code(400).send({
      message: error.message,
      error: {
        code: "instructions_too_long",
        message: error.message,
        personaName: error.personaName,
        scenarioName: error.scenarioName,
        actualLength: error.actualLength,
        maximumLength: MAX_REALTIME_INSTRUCTIONS_LENGTH,
      },
    });
  }

  throw error;
}
