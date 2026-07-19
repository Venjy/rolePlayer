import {
  personaInputSchema,
  personaSchema,
  rolePlayCatalogSchema,
  scenarioInputSchema,
  scenarioSchema,
  type Persona,
  type PersonaDraftGenerationContext,
  type PersonaInput,
  type RolePlayCatalog,
  type Scenario,
  type ScenarioDraftGenerationContext,
  type ScenarioInput,
} from "../../shared/role-play-catalog";

interface ApiErrorBody {
  message?: string;
  error?: { code?: string };
}

export class CatalogApiError extends Error {
  public constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "CatalogApiError";
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // A useful status fallback is better than masking the original failure.
    }
    throw new CatalogApiError(
      body?.message ?? `Request failed with HTTP ${response.status}.`,
      body?.error?.code,
    );
  }

  return parse(await response.json());
}

async function requestEmpty(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, init);
  if (response.ok) return;

  let body: ApiErrorBody | undefined;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Fall through to the status-based message.
  }
  throw new Error(body?.message ?? `Request failed with HTTP ${response.status}.`);
}

export function fetchRolePlayCatalog(signal?: AbortSignal): Promise<RolePlayCatalog> {
  return requestJson(
    "/api/catalog",
    { method: "GET", signal },
    (value) => rolePlayCatalogSchema.parse(value),
  );
}

export function createPersona(input: PersonaInput): Promise<Persona> {
  return requestJson(
    "/api/personas",
    { method: "POST", body: JSON.stringify(input) },
    (value) => personaSchema.parse(value),
  );
}

export function generatePersonaDraft(
  currentDraft: PersonaDraftGenerationContext | undefined,
  signal?: AbortSignal,
): Promise<PersonaInput> {
  return requestJson(
    "/api/catalog/generate/persona",
    { method: "POST", body: JSON.stringify({ currentDraft }), signal },
    (value) => personaInputSchema.parse(value),
  );
}

export function updatePersona(id: number, input: PersonaInput): Promise<Persona> {
  return requestJson(
    `/api/personas/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) },
    (value) => personaSchema.parse(value),
  );
}

export function deletePersona(id: number): Promise<void> {
  return requestEmpty(`/api/personas/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function createScenario(input: ScenarioInput): Promise<Scenario> {
  return requestJson(
    "/api/scenarios",
    { method: "POST", body: JSON.stringify(input) },
    (value) => scenarioSchema.parse(value),
  );
}

export function generateScenarioDraft(
  currentDraft: ScenarioDraftGenerationContext | undefined,
  signal?: AbortSignal,
): Promise<ScenarioInput> {
  return requestJson(
    "/api/catalog/generate/scenario",
    { method: "POST", body: JSON.stringify({ currentDraft }), signal },
    (value) => scenarioInputSchema.parse(value),
  );
}

export function updateScenario(
  id: number,
  input: ScenarioInput,
): Promise<Scenario> {
  return requestJson(
    `/api/scenarios/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) },
    (value) => scenarioSchema.parse(value),
  );
}

export function deleteScenario(id: number): Promise<void> {
  return requestEmpty(`/api/scenarios/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
