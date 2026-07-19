import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Persona, PersonaInput, RolePlayCatalog, Scenario, ScenarioInput } from "../../src/shared/role-play-catalog";
import { rolePlayCatalogSchema } from "../../src/shared/role-play-catalog";
import { initializeCatalogData } from "../../src/server/catalog/catalog-initializer";
import { registerCatalogRoutes } from "../../src/server/catalog/catalog-routes";
import { registerDatabases } from "../../src/server/database/register-database";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function presetId(catalog: RolePlayCatalog, valueZhCn: string): number {
  const preset = [...catalog.personaPresets, ...catalog.scenarioPresets].find(
    (candidate) => candidate.valueZhCn === valueZhCn,
  );
  if (!preset) throw new Error(`Missing test preset: ${valueZhCn}`);
  return preset.id;
}

function personaInput(catalog: RolePlayCatalog): PersonaInput {
  return {
  name: "", nameZhCn: "张三", gender: "male", age: 29,
  occupationPresetId: presetId(catalog, "外卖员"),
  background: "", backgroundZhCn: "每天长时间骑行。",
  personalityTraitPresetIds: [presetId(catalog, "务实")],
  communicationStylePresetId: presetId(catalog, "直接简洁"),
  behaviorNotes: "", behaviorNotesZhCn: "追问价格。",
  motivationPresetIds: [presetId(catalog, "节省成本")],
  concernPresetIds: [presetId(catalog, "价格与预算")],
  voice: "longanlingxin",
  };
}
function scenarioInput(catalog: RolePlayCatalog, allowedPersonaIds: number[]): ScenarioInput {
  const goalId = presetId(catalog, "识别客户需求");
  const skillId = presetId(catalog, "开放式提问");
  const successId = presetId(catalog, "发现一项明确的客户需求");
  return {
    name: "", nameZhCn: "电动车租赁咨询",
    description: "", descriptionZhCn: "介绍电动车租赁方案。",
    trainingGoalPresetIds: [goalId],
    skillFocusPresetIds: [skillId],
    successCriterionPresetIds: [successId],
    toneStylePresetId: presetId(catalog, "专业沉稳"),
    voiceBehavior: { interruptFrequency: "medium", speakingPace: "fast" },
    scoringCriteria: [{ successCriterionPresetId: successId, weight: 100 }],
    allowedPersonaIds,
  };
}
function createApp() {
  const directory = mkdtempSync(join(tmpdir(), "role-player-catalog-api-"));
  directories.push(directory);
  const app = Fastify({ logger: false });
  registerDatabases(app, {
    catalogPath: join(directory, "catalog.sqlite"),
    conversationPath: join(directory, "conversations.sqlite"),
  });
  registerCatalogRoutes(app);
  return app;
}

describe("catalog routes", () => {
  it("returns the JSON-initialized bilingual catalog", async () => {
    const app = createApp();
    try {
      await app.ready();
      initializeCatalogData(app.catalogDatabase);
      const response = await app.inject({ method: "GET", url: "/api/catalog" });
      expect(response.statusCode).toBe(200);
      const catalog = rolePlayCatalogSchema.parse(response.json());
      expect(catalog.qwenVoices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          voice: "longanlufeng",
          name: "Cheerful male voice",
          nameZhCn: "开朗男声",
        }),
      ]));
      expect(catalog.personaPresets).toEqual(expect.arrayContaining([
        expect.objectContaining({ category: "occupation", value: "Sales Director", valueZhCn: "销售总监" }),
      ]));
      expect(catalog.personas).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Lin Yue", nameZhCn: "林悦", occupation: "Marketing Director" }),
      ]));
    } finally {
      await app.close();
    }
  });

  it("supports independent content CRUD and separately stored compatibility", async () => {
    const app = createApp();
    try {
      await app.ready();
      initializeCatalogData(app.catalogDatabase);
      const catalog = rolePlayCatalogSchema.parse(
        (await app.inject({ method: "GET", url: "/api/catalog" })).json(),
      );
      const createdPersonaResponse = await app.inject({ method: "POST", url: "/api/personas", payload: personaInput(catalog) });
      expect(createdPersonaResponse.statusCode).toBe(201);
      const persona = createdPersonaResponse.json<Persona>();
      expect(persona).toMatchObject({ name: "", nameZhCn: "张三", occupationZhCn: "外卖员" });

      const createdScenarioResponse = await app.inject({
        method: "POST", url: "/api/scenarios", payload: scenarioInput(catalog, [persona.id]),
      });
      expect(createdScenarioResponse.statusCode).toBe(201);
      const scenario = createdScenarioResponse.json<Scenario>();
      expect(scenario.allowedPersonaIds).toEqual([persona.id]);

      const updatedResponse = await app.inject({
        method: "PUT",
        url: `/api/scenarios/${scenario.id}`,
        payload: { ...scenarioInput(catalog, []), name: "E-bike consultation" },
      });
      expect(updatedResponse.statusCode).toBe(200);
      expect(updatedResponse.json<Scenario>()).toMatchObject({
        name: "E-bike consultation", nameZhCn: "电动车租赁咨询", allowedPersonaIds: [],
      });

      const deletePersona = await app.inject({ method: "DELETE", url: `/api/personas/${persona.id}` });
      expect(deletePersona.statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it("rejects unknown compatibility references", async () => {
    const app = createApp();
    try {
      await app.ready();
      initializeCatalogData(app.catalogDatabase);
      const catalog = rolePlayCatalogSchema.parse(
        (await app.inject({ method: "GET", url: "/api/catalog" })).json(),
      );
      const response = await app.inject({
        method: "POST", url: "/api/scenarios", payload: scenarioInput(catalog, [999_999]),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "unknown_persona_reference", personaIds: [999_999] },
      });
    } finally {
      await app.close();
    }
  });
});
