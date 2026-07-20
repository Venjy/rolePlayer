import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Persona, PersonaInput, RolePlayCatalog, Scenario, ScenarioInput } from "../../src/shared/role-play-catalog";
import { rolePlayCatalogSchema } from "../../src/shared/role-play-catalog";
import { initializeCatalogData } from "../../src/server/catalog/catalog-initializer";
import type { CatalogDraftGenerator } from "../../src/server/catalog/catalog-draft-generator";
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
  occupationPresetId: presetId(catalog, "采购专员"),
  background: "", backgroundZhCn: "负责区域物流运营与交付效率。",
  personalityTraitPresetIds: [presetId(catalog, "务实")],
  communicationStylePresetId: presetId(catalog, "直接简洁"),
  behaviorNotes: "", behaviorNotesZhCn: "追问价格。",
  motivationPresetIds: [presetId(catalog, "节省成本")],
  concernPresetIds: [presetId(catalog, "价格与预算")],
  voice: "longanlufeng",
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
function createApp(draftGenerator?: CatalogDraftGenerator) {
  const directory = mkdtempSync(join(tmpdir(), "role-player-catalog-api-"));
  directories.push(directory);
  const app = Fastify({ logger: false });
  registerDatabases(app, {
    catalogPath: join(directory, "catalog.sqlite"),
    conversationPath: join(directory, "conversations.sqlite"),
  });
  registerCatalogRoutes(app, { draftGenerator });
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
        expect.objectContaining({ category: "occupation", value: "Restaurant Owner", valueZhCn: "餐馆老板" }),
      ]));
      expect(catalog.personas).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Lin Yue", nameZhCn: "林悦", occupation: "Online Seller" }),
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
      expect(persona).toMatchObject({ name: "", nameZhCn: "张三", occupationZhCn: "采购专员" });

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

  it("persists optional scenario guidance without inventing scoring weights", async () => {
    const app = createApp();
    try {
      await app.ready();
      initializeCatalogData(app.catalogDatabase);
      const catalog = rolePlayCatalogSchema.parse(
        (await app.inject({ method: "GET", url: "/api/catalog" })).json(),
      );
      const successId = presetId(catalog, "发现一项明确的客户需求");
      const response = await app.inject({
        method: "POST",
        url: "/api/scenarios",
        payload: {
          name: "Optional rubric scenario",
          nameZhCn: "可选评分场景",
          description: "A scenario that has guidance but no numeric rubric.",
          descriptionZhCn: "包含达成标准但不进行数字评分的场景。",
          trainingGoalPresetIds: [],
          skillFocusPresetIds: [],
          successCriterionPresetIds: [successId],
          voiceBehavior: {},
          scoringCriteria: [],
          allowedPersonaIds: [],
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<Scenario>()).toMatchObject({
        trainingGoalPresetIds: [],
        skillFocusPresetIds: [],
        successCriterionPresetIds: [successId],
        scoringCriteria: [],
      });
      expect(
        app.catalogDatabase.raw
          .prepare(
            `SELECT success_criterion_preset_id, weight
             FROM scenario_success_criteria
             WHERE scenario_id = ?`,
          )
          .all(response.json<Scenario>().id),
      ).toEqual([{ success_criterion_preset_id: successId, weight: null }]);
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

  it("exposes generated bilingual drafts without saving them", async () => {
    const generatePersona = vi.fn(async (catalog: RolePlayCatalog) => ({
      ...personaInput(catalog),
      name: "Jordan Lee",
      nameZhCn: "李乔丹",
      background: "Leads a regional logistics operation with a measurable delivery bottleneck.",
      backgroundZhCn: "负责区域物流运营，并面临可量化的配送瓶颈。",
      behaviorNotes: "Challenges unsupported claims and asks for implementation evidence.",
      behaviorNotesZhCn: "会质疑缺少依据的承诺，并追问实施证据。",
    }));
    const generateScenario = vi.fn(async (catalog: RolePlayCatalog) => ({
      ...scenarioInput(catalog, catalog.personas.map(({ id }) => id)),
      name: "Logistics process review",
      nameZhCn: "物流流程评估",
      description: "The buyer needs to reduce missed delivery windows before peak season.",
      descriptionZhCn: "客户需要在旺季前减少配送超时。",
    }));
    const draftGenerator: CatalogDraftGenerator = {
      generatePersona,
      generateScenario,
    };
    const app = createApp(draftGenerator);
    try {
      await app.ready();
      initializeCatalogData(app.catalogDatabase);
      const before = rolePlayCatalogSchema.parse(
        (await app.inject({ method: "GET", url: "/api/catalog" })).json(),
      );

      const personaResponse = await app.inject({
        method: "POST",
        url: "/api/catalog/generate/persona",
        payload: {
          currentDraft: {
            name: "Current draft",
            background: "Current persona background",
          },
        },
      });
      expect(personaResponse.statusCode).toBe(200);
      expect(personaResponse.json()).toMatchObject({
        name: "Jordan Lee",
        nameZhCn: "李乔丹",
      });

      const scenarioResponse = await app.inject({
        method: "POST",
        url: "/api/catalog/generate/scenario",
        payload: {
          currentDraft: {
            nameZhCn: "当前场景草稿",
            descriptionZhCn: "当前场景描述",
          },
        },
      });
      expect(scenarioResponse.statusCode).toBe(200);
      expect(scenarioResponse.json()).toMatchObject({
        name: "Logistics process review",
        nameZhCn: "物流流程评估",
      });
      expect(generatePersona).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          name: "Current draft",
          background: "Current persona background",
        }),
      );
      expect(generateScenario).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          nameZhCn: "当前场景草稿",
          descriptionZhCn: "当前场景描述",
        }),
      );

      const emptyPersonaResponse = await app.inject({
        method: "POST",
        url: "/api/catalog/generate/persona",
        payload: {
          currentDraft: {
            name: "",
            personalityTraitPresetIds: [],
            motivationPresetIds: [],
          },
        },
      });
      expect(emptyPersonaResponse.statusCode).toBe(200);
      expect(generatePersona).toHaveBeenLastCalledWith(
        expect.any(Object),
        undefined,
      );

      const emptyScenarioResponse = await app.inject({
        method: "POST",
        url: "/api/catalog/generate/scenario",
        payload: {
          currentDraft: {
            name: "",
            trainingGoalPresetIds: [],
            voiceBehavior: {},
          },
        },
      });
      expect(emptyScenarioResponse.statusCode).toBe(200);
      expect(generateScenario).toHaveBeenLastCalledWith(
        expect.any(Object),
        undefined,
      );
      const after = rolePlayCatalogSchema.parse(
        (await app.inject({ method: "GET", url: "/api/catalog" })).json(),
      );
      expect(after.personas).toHaveLength(before.personas.length);
      expect(after.scenarios).toHaveLength(before.scenarios.length);
    } finally {
      await app.close();
    }
  });
});
