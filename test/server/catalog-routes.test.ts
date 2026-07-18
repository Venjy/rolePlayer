import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Persona,
  PersonaInput,
  Scenario,
  ScenarioInput,
} from "../../src/shared/role-play-catalog";
import { rolePlayCatalogSchema } from "../../src/shared/role-play-catalog";
import {
  INITIAL_PERSONA_PRESETS,
  initializeCatalogData,
} from "../../src/server/catalog/catalog-initializer";
import { registerCatalogRoutes } from "../../src/server/catalog/catalog-routes";
import { registerDatabase } from "../../src/server/database/register-database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const personaInput: PersonaInput = {
  name: "小张",
  gender: "female",
  age: 29,
  occupation: "外卖员",
  identity: "一位正在评估电动车租赁服务的外卖员",
  background: "每天需要长时间骑行，近期考虑更换车辆。",
  personalityTraits: ["务实", "谨慎"],
  communicationStyle: "说话直接，会追问价格和维修细节。",
  behaviorNotes: "对空泛的销售话术缺乏耐心。",
  motivations: ["降低日常车辆成本"],
  concerns: ["续航", "维修响应时间"],
  voice: "longanlingxin",
};

function scenarioInput(allowedPersonaIds: string[]): ScenarioInput {
  return {
    name: "电动车租赁咨询",
    description: "向高频使用车辆的外卖员介绍电动车租赁方案。",
    goals: ["理解用车需求", "确认下一步试用安排"],
    suggestedSkillFocus: ["需求发现", "异议处理"],
    successCriteria: ["确认预算和续航需求"],
    scoringCriteria: [
      { name: "需求发现", weight: 60 },
      { name: "下一步", weight: 40 },
    ],
    allowedPersonaIds,
    voiceBehavior: {
      interruptFrequency: "medium",
      speakingPace: "fast",
      toneStyle: "直接而务实",
    },
  };
}

function createApp() {
  const directory = mkdtempSync(join(tmpdir(), "role-player-catalog-api-"));
  temporaryDirectories.push(directory);
  const app = Fastify({ logger: false });
  registerDatabase(app, { path: join(directory, "catalog.sqlite") });
  registerCatalogRoutes(app);
  return app;
}

describe("role-play catalog routes", () => {
  it("returns database-backed presets and initialized personas", async () => {
    const app = createApp();
    try {
      await app.ready();
      const initialized = initializeCatalogData(app.database);
      expect(initialized.presetRowsInserted).toBe(
        INITIAL_PERSONA_PRESETS.length,
      );

      const response = await app.inject({ method: "GET", url: "/api/catalog" });

      expect(response.statusCode).toBe(200);
      const catalog = rolePlayCatalogSchema.parse(response.json());
      expect(catalog.personaPresets).toHaveLength(
        INITIAL_PERSONA_PRESETS.length,
      );
      expect(catalog.personaPresets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "preset_occupation_marketing_director",
            category: "occupation",
            value: "市场营销总监",
            position: 0,
          }),
          expect.objectContaining({
            id: "preset_trait_pragmatic",
            category: "personality_trait",
            value: "务实",
            position: 0,
          }),
        ]),
      );
      expect(catalog.personas).toEqual(
        expect.arrayContaining([
        expect.objectContaining({
          id: "persona_alex",
          name: "Alex",
          personalityTraits: ["thoughtful", "slightly skeptical", "pragmatic"],
        }),
          expect.objectContaining({
            id: "persona_lin_yue",
            name: "林悦",
            occupation: "市场营销总监",
          }),
          expect.objectContaining({
            id: "persona_wang_qiang",
            name: "王强",
            occupation: "采购经理",
          }),
          expect.objectContaining({
            id: "persona_chen_chen",
            name: "陈晨",
            occupation: "小微企业主",
          }),
        ]),
      );
      expect(catalog.scenarios).toEqual([
        expect.objectContaining({
          id: "scenario_sales_discovery",
          allowedPersonaIds: [
            "persona_alex",
            "persona_lin_yue",
            "persona_wang_qiang",
            "persona_chen_chen",
          ],
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it("supports persona and scenario CRUD while enforcing compatibility", async () => {
    const app = createApp();
    try {
      const invalidPersona = await app.inject({
        method: "POST",
        url: "/api/personas",
        payload: { ...personaInput, age: 0 },
      });
      expect(invalidPersona.statusCode).toBe(400);
      expect(invalidPersona.json()).toMatchObject({
        error: { code: "invalid_request" },
      });

      const createPersona = await app.inject({
        method: "POST",
        url: "/api/personas",
        payload: personaInput,
      });
      expect(createPersona.statusCode).toBe(201);
      const persona = createPersona.json<Persona>();
      expect(persona).toMatchObject(personaInput);
      expect(persona.id).toMatch(/^persona_/);
      expect(persona.createdAt).toBe(persona.updatedAt);

      const duplicatePersona = await app.inject({
        method: "POST",
        url: "/api/personas",
        payload: { ...personaInput, name: "小张" },
      });
      expect(duplicatePersona.statusCode).toBe(409);
      expect(duplicatePersona.json()).toMatchObject({
        error: { code: "duplicate_name", entity: "persona" },
      });

      const updatePersona = await app.inject({
        method: "PUT",
        url: `/api/personas/${persona.id}`,
        payload: { ...personaInput, occupation: "配送站站长" },
      });
      expect(updatePersona.statusCode).toBe(200);
      const updatedPersona = updatePersona.json<Persona>();
      expect(updatedPersona).toMatchObject({
        id: persona.id,
        occupation: "配送站站长",
        createdAt: persona.createdAt,
      });
      expect(updatedPersona.updatedAt).not.toBe(persona.updatedAt);

      const missingCompatibility = await app.inject({
        method: "POST",
        url: "/api/scenarios",
        payload: scenarioInput(["persona_missing"]),
      });
      expect(missingCompatibility.statusCode).toBe(400);
      expect(missingCompatibility.json()).toMatchObject({
        error: {
          code: "unknown_persona_reference",
          personaIds: ["persona_missing"],
        },
      });

      const createScenario = await app.inject({
        method: "POST",
        url: "/api/scenarios",
        payload: scenarioInput([persona.id, "persona_alex"]),
      });
      expect(createScenario.statusCode).toBe(201);
      const scenario = createScenario.json<Scenario>();
      expect(scenario).toMatchObject({
        ...scenarioInput([persona.id, "persona_alex"]),
        id: expect.stringMatching(/^scenario_/),
      });

      const blockedDelete = await app.inject({
        method: "DELETE",
        url: `/api/personas/${persona.id}`,
      });
      expect(blockedDelete.statusCode).toBe(409);
      expect(blockedDelete.json()).toMatchObject({
        error: {
          code: "persona_in_use",
          personaId: persona.id,
          scenarioIds: [scenario.id],
        },
      });

      const updateScenario = await app.inject({
        method: "PUT",
        url: `/api/scenarios/${scenario.id}`,
        payload: {
          ...scenarioInput(["persona_alex"]),
          name: "更新后的销售场景",
        },
      });
      expect(updateScenario.statusCode).toBe(200);
      const updatedScenario = updateScenario.json<Scenario>();
      expect(updatedScenario).toMatchObject({
        id: scenario.id,
        name: "更新后的销售场景",
        allowedPersonaIds: ["persona_alex"],
      });
      expect(updatedScenario.createdAt).toBe(scenario.createdAt);
      expect(updatedScenario.updatedAt).not.toBe(scenario.updatedAt);

      const deletePersona = await app.inject({
        method: "DELETE",
        url: `/api/personas/${persona.id}`,
      });
      expect(deletePersona.statusCode).toBe(204);
      expect(deletePersona.body).toBe("");

      const deleteScenario = await app.inject({
        method: "DELETE",
        url: `/api/scenarios/${scenario.id}`,
      });
      expect(deleteScenario.statusCode).toBe(204);

      const missingScenario = await app.inject({
        method: "DELETE",
        url: `/api/scenarios/${scenario.id}`,
      });
      expect(missingScenario.statusCode).toBe(404);
      expect(missingScenario.json()).toMatchObject({
        error: { code: "scenario_not_found" },
      });

      const missingPersonaUpdate = await app.inject({
        method: "PUT",
        url: "/api/personas/persona_missing",
        payload: personaInput,
      });
      expect(missingPersonaUpdate.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("rejects a compatible persona/scenario pair that cannot fit the realtime prompt", async () => {
    const app = createApp();
    try {
      const largePersonaInput: PersonaInput = {
        name: "Length boundary persona",
        gender: "unspecified",
        age: 40,
        occupation: "o".repeat(120),
        identity: "i".repeat(240),
        background: "b".repeat(2_000),
        personalityTraits: Array.from(
          { length: 12 },
          (_, index) => `${index}`.padEnd(160, "t"),
        ),
        communicationStyle: "c".repeat(500),
        behaviorNotes: "n".repeat(2_000),
        motivations: Array.from(
          { length: 10 },
          (_, index) => `${index}`.padEnd(160, "m"),
        ),
        concerns: Array.from(
          { length: 10 },
          (_, index) => `${index}`.padEnd(160, "q"),
        ),
        voice: "longanqian",
      };
      const createPersona = await app.inject({
        method: "POST",
        url: "/api/personas",
        payload: largePersonaInput,
      });
      expect(createPersona.statusCode).toBe(201);
      const persona = createPersona.json<Persona>();

      const oversizedScenario: ScenarioInput = {
        name: "Length boundary scenario",
        description: "d".repeat(2_000),
        goals: Array.from(
          { length: 10 },
          (_, index) => `${index}`.padEnd(160, "g"),
        ),
        suggestedSkillFocus: Array.from(
          { length: 10 },
          (_, index) => `${index}`.padEnd(160, "f"),
        ),
        successCriteria: Array.from(
          { length: 12 },
          (_, index) => `${index}`.padEnd(160, "s"),
        ),
        scoringCriteria: Array.from({ length: 12 }, (_, index) => ({
          name: `criterion-${index}`.padEnd(100, "x"),
          weight: index === 0 ? 89 : 1,
        })),
        allowedPersonaIds: [persona.id],
        voiceBehavior: {
          interruptFrequency: "high",
          speakingPace: "fast",
          toneStyle: "t".repeat(160),
        },
      };
      const response = await app.inject({
        method: "POST",
        url: "/api/scenarios",
        payload: oversizedScenario,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: "instructions_too_long",
          personaName: largePersonaInput.name,
          scenarioName: oversizedScenario.name,
          maximumLength: 12_000,
        },
      });
    } finally {
      await app.close();
    }
  });
});
