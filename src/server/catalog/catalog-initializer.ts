import type { DatabaseSync } from "node:sqlite";
import type {
  PersonaInput,
  PersonaPresetCategory,
} from "../../shared/role-play-catalog";
import {
  MAX_SCENARIO_PERSONAS,
  personaInputSchema,
  personaPresetSchema,
} from "../../shared/role-play-catalog";
import { findRolePlayInstructionsLengthIssue } from "../../shared/role-play-instructions";
import type { ApplicationDatabase } from "../database/database";
import { CatalogRepository } from "./catalog-repository";

interface InitialPersonaPreset {
  id: string;
  category: PersonaPresetCategory;
  value: string;
  valueEn: string;
  position: number;
}

interface InitialCatalogPersona {
  id: string;
  input: PersonaInput;
}

export interface CatalogInitializationResult {
  presetRowsInserted: number;
  presetRowsSkipped: number;
  presetTranslationsUpdated: number;
  personaRowsInserted: number;
  personaRowsSkipped: number;
  scenarioLinksInserted: number;
  scenarioLinksSkipped: number;
  defaultScenarioFound: boolean;
}

export class CatalogInitializationInstructionsTooLongError extends Error {
  public constructor(
    public readonly personaId: string,
    public readonly personaName: string,
    public readonly scenarioId: string,
    public readonly scenarioName: string,
    public readonly difficulty: "easy" | "medium" | "hard",
    public readonly actualLength: number,
    public readonly maximumLength: number,
  ) {
    super(
      `Cannot initialize the link between persona "${personaName}" and scenario "${scenarioName}": ${difficulty} Instructions are too long (${actualLength}/${maximumLength} characters).`,
    );
    this.name = "CatalogInitializationInstructionsTooLongError";
  }
}

export class CatalogInitializationScenarioCapacityError extends Error {
  public constructor(
    public readonly scenarioId: string,
    public readonly scenarioName: string,
    public readonly personaId: string,
    public readonly currentPersonaCount: number,
    public readonly maximumPersonaCount: number,
  ) {
    super(
      `Cannot initialize the link to persona "${personaId}": scenario "${scenarioName}" already has ${currentPersonaCount}/${maximumPersonaCount} compatible personas.`,
    );
    this.name = "CatalogInitializationScenarioCapacityError";
  }
}

export const DEFAULT_INITIAL_SCENARIO_ID = "scenario_sales_discovery";

function presetGroup(
  category: PersonaPresetCategory,
  entries: readonly (readonly [id: string, value: string, valueEn: string])[],
): InitialPersonaPreset[] {
  return entries.map(([id, value, valueEn], position) => ({
    id,
    category,
    value,
    valueEn,
    position,
  }));
}

/**
 * Stable, deployment-owned choices for the persona editor. Positions are
 * scoped to a category and are deliberately explicit through array order.
 */
export const INITIAL_PERSONA_PRESETS: readonly InitialPersonaPreset[] = [
  ...presetGroup("identity", [
    [
      "preset_identity_business_decision_maker",
      "业务部门的最终决策者",
      "Final decision-maker for a business unit",
    ],
    [
      "preset_identity_management_recommender",
      "负责方案评估并向管理层提出建议的业务负责人",
      "Business leader who evaluates solutions and makes recommendations to management",
    ],
    [
      "preset_identity_procurement_decision_maker",
      "负责供应商筛选、商务谈判与风险控制的采购决策者",
      "Procurement decision-maker responsible for supplier selection, commercial negotiations, and risk control",
    ],
    [
      "preset_identity_small_business_owner",
      "直接负责经营、现金流与最终购买决策的小微企业主",
      "Small-business owner directly responsible for operations, cash flow, and final purchasing decisions",
    ],
    [
      "preset_identity_technical_evaluator",
      "负责技术选型、系统集成与信息安全的技术评估者",
      "Technical evaluator responsible for technology selection, systems integration, and information security",
    ],
    [
      "preset_identity_daily_user_influencer",
      "产品的日常使用者和内部影响者",
      "Daily product user and internal influencer",
    ],
    [
      "preset_identity_marketing_decision_maker",
      "负责增长与品牌建设的市场营销决策者",
      "Marketing decision-maker responsible for growth and brand building",
    ],
    [
      "preset_identity_people_manager",
      "关注团队效率与人才发展的管理者",
      "Manager focused on team efficiency and talent development",
    ],
  ]),
  ...presetGroup("occupation", [
    ["preset_occupation_marketing_director", "市场营销总监", "Marketing Director"],
    ["preset_occupation_procurement_manager", "采购经理", "Procurement Manager"],
    ["preset_occupation_small_business_owner", "小微企业主", "Small-business Owner"],
    ["preset_occupation_sales_director", "销售总监", "Sales Director"],
    ["preset_occupation_operations_director", "运营总监", "Operations Director"],
    ["preset_occupation_hr_manager", "人力资源经理", "Human Resources Manager"],
    ["preset_occupation_finance_lead", "财务负责人", "Finance Lead"],
    ["preset_occupation_it_lead", "IT 负责人", "IT Lead"],
    ["preset_occupation_store_manager", "门店店长", "Store Manager"],
    [
      "preset_occupation_customer_success_manager",
      "客户成功经理",
      "Customer Success Manager",
    ],
    ["preset_occupation_startup_founder", "创业公司创始人", "Startup Founder"],
    [
      "preset_occupation_ecommerce_operator",
      "电商运营负责人",
      "E-commerce Operations Lead",
    ],
  ]),
  ...presetGroup("personality_trait", [
    ["preset_trait_pragmatic", "务实", "Pragmatic"],
    ["preset_trait_cautious", "谨慎", "Cautious"],
    ["preset_trait_data_driven", "数据驱动", "Data-driven"],
    ["preset_trait_open_curious", "开放好奇", "Open and curious"],
    ["preset_trait_detail_oriented", "注重细节", "Detail-oriented"],
    ["preset_trait_cost_conscious", "成本敏感", "Cost-conscious"],
    ["preset_trait_results_oriented", "结果导向", "Results-oriented"],
    ["preset_trait_patient", "耐心", "Patient"],
    ["preset_trait_assertive", "强势", "Assertive"],
    ["preset_trait_skeptical", "怀疑精神", "Skeptical"],
    ["preset_trait_time_pressed", "时间紧迫", "Time-pressed"],
    ["preset_trait_risk_averse", "风险规避", "Risk-averse"],
    ["preset_trait_friendly_talkative", "友善健谈", "Friendly and talkative"],
    ["preset_trait_decisive", "决断果断", "Decisive"],
    ["preset_trait_conservative", "保守传统", "Conservative and traditional"],
    ["preset_trait_early_adopter", "乐于尝试新事物", "Eager to try new things"],
  ]),
  ...presetGroup("communication_style", [
    [
      "preset_communication_data_driven",
      "表达清晰，会用业务数据追问方案价值与落地路径",
      "Communicates clearly and uses business data to probe solution value and implementation",
    ],
    [
      "preset_communication_commercial_direct",
      "简洁直接，围绕价格、合同条款和风险连续追问",
      "Concise and direct, with persistent questions about pricing, contract terms, and risk",
    ],
    [
      "preset_communication_fast_pragmatic",
      "节奏快且口语化，只关心能否马上解决问题",
      "Fast-paced and conversational, focused only on whether the problem can be solved immediately",
    ],
    [
      "preset_communication_friendly_exploratory",
      "友好健谈，愿意分享背景并接受开放式提问",
      "Friendly and talkative, willing to share context and engage with open-ended questions",
    ],
    [
      "preset_communication_evidence_first",
      "谨慎克制，需要看到具体证据后才会表态",
      "Cautious and reserved, requiring concrete evidence before expressing a view",
    ],
    [
      "preset_communication_challenging",
      "强势且有挑战性，会打断空泛陈述并要求明确答案",
      "Assertive and challenging, interrupting vague claims and demanding clear answers",
    ],
    [
      "preset_communication_structured",
      "条理细致，习惯逐项确认功能、流程和责任边界",
      "Structured and detail-oriented, checking features, processes, and responsibilities one by one",
    ],
    [
      "preset_communication_plain_language",
      "不熟悉技术术语，需要使用简单语言和具体案例",
      "Unfamiliar with technical jargon and needs plain language and concrete examples",
    ],
  ]),
  ...presetGroup("motivation", [
    ["preset_motivation_lead_generation", "提升获客效率", "Improve lead generation efficiency"],
    ["preset_motivation_lower_procurement_cost", "降低采购总成本", "Reduce total procurement cost"],
    ["preset_motivation_team_efficiency", "提高团队工作效率", "Improve team productivity"],
    ["preset_motivation_reduce_manual_work", "减少重复人工", "Reduce repetitive manual work"],
    ["preset_motivation_grow_revenue", "尽快提升营收", "Grow revenue quickly"],
    ["preset_motivation_quick_adoption", "缩短团队上手周期", "Shorten team onboarding time"],
    ["preset_motivation_prove_roi", "证明投资回报", "Demonstrate return on investment"],
    ["preset_motivation_customer_experience", "改善客户体验", "Improve customer experience"],
    ["preset_motivation_reduce_risk", "降低运营风险", "Reduce operational risk"],
    ["preset_motivation_better_terms", "获得更有利的商务条款", "Secure more favorable commercial terms"],
    ["preset_motivation_fast_low_cost_launch", "低成本快速上线", "Launch quickly at low cost"],
    ["preset_motivation_scale_growth", "支持业务规模化增长", "Support scalable business growth"],
  ]),
  ...presetGroup("concern", [
    ["preset_concern_roi", "投入产出比", "Return on investment"],
    ["preset_concern_over_budget", "价格超出预算", "Price exceeds budget"],
    ["preset_concern_integration_cost", "系统集成成本", "Systems integration cost"],
    ["preset_concern_team_adoption", "团队采纳难度", "Difficulty of team adoption"],
    ["preset_concern_data_security", "数据安全与隐私", "Data security and privacy"],
    ["preset_concern_supplier_stability", "供应商稳定性", "Supplier stability"],
    ["preset_concern_contract_support", "合同与售后保障", "Contract terms and after-sales support"],
    ["preset_concern_implementation_time", "实施周期过长", "Implementation takes too long"],
    ["preset_concern_migration_learning", "迁移与学习成本", "Migration and learning costs"],
    ["preset_concern_workflow_disruption", "对现有流程的干扰", "Disruption to existing workflows"],
    ["preset_concern_product_fit", "功能与实际需求不匹配", "Feature fit with actual needs"],
    ["preset_concern_cash_flow", "现金流压力", "Cash-flow pressure"],
    ["preset_concern_support_response", "售后响应速度", "After-sales response time"],
    ["preset_concern_hidden_fees", "隐性费用", "Hidden fees"],
  ]),
];

/** Three immediately usable, intentionally different sales prospects. */
export const INITIAL_CATALOG_PERSONAS: readonly InitialCatalogPersona[] = [
  {
    id: "persona_lin_yue",
    input: personaInputSchema.parse({
      name: "林悦",
      gender: "female",
      age: 34,
      occupation: "市场营销总监",
      identity: "负责增长与品牌建设的市场营销决策者",
      background:
        "林悦负责一家成长型消费品牌的市场团队。获客成本持续上升，她正在评估能够提升线索质量和团队跟进效率的方案。",
      personalityTraits: ["数据驱动", "开放好奇", "结果导向"],
      communicationStyle: "表达清晰，会用业务数据追问方案价值与落地路径",
      behaviorNotes:
        "愿意讨论新思路，但会要求销售把价值落实到可衡量指标、实施计划和明确的下一步。",
      motivations: ["提升获客效率", "证明投资回报", "缩短团队上手周期"],
      concerns: ["投入产出比", "系统集成成本", "团队采纳难度"],
      voice: "longanlingxin",
    }),
  },
  {
    id: "persona_wang_qiang",
    input: personaInputSchema.parse({
      name: "王强",
      gender: "male",
      age: 46,
      occupation: "采购经理",
      identity: "负责供应商筛选、商务谈判与风险控制的采购决策者",
      background:
        "王强在一家中型制造企业负责采购。他正在比较多家供应商，内部要求他控制总成本并降低交付和售后风险。",
      personalityTraits: ["成本敏感", "谨慎", "风险规避"],
      communicationStyle: "简洁直接，围绕价格、合同条款和风险连续追问",
      behaviorNotes:
        "不会因为泛泛的功能介绍做决定。只有在价格依据、交付承诺和风险处理方式清晰时才会继续推进。",
      motivations: ["降低采购总成本", "降低运营风险", "获得更有利的商务条款"],
      concerns: ["价格超出预算", "供应商稳定性", "合同与售后保障"],
      voice: "longanlufeng",
    }),
  },
  {
    id: "persona_chen_chen",
    input: personaInputSchema.parse({
      name: "陈晨",
      gender: "unspecified",
      age: 38,
      occupation: "小微企业主",
      identity: "直接负责经营、现金流与最终购买决策的小微企业主",
      background:
        "陈晨经营一家本地生活服务公司，既管销售也管日常运营。团队人手有限，希望尽快解决重复工作和客户跟进不及时的问题。",
      personalityTraits: ["务实", "时间紧迫", "结果导向"],
      communicationStyle: "节奏快且口语化，只关心能否马上解决问题",
      behaviorNotes:
        "时间有限，对复杂术语和冗长演示缺乏耐心。只有方案简单、成本可控并能快速见效时才愿意尝试。",
      motivations: ["尽快提升营收", "减少重复人工", "低成本快速上线"],
      concerns: ["现金流压力", "迁移与学习成本", "售后响应速度"],
      voice: "longanxiaoxin",
    }),
  },
];

/**
 * Inserts deployment starter data in one transaction. Every insert is
 * conflict-tolerant. The only update is a one-time English-value backfill for
 * a stable seed ID whose translation is blank; non-empty administrator edits
 * remain untouched. Missing links are appended after the scenario's current
 * last position instead of reordering existing compatibility entries.
 */
export function initializeCatalogData(
  database: ApplicationDatabase,
): CatalogInitializationResult {
  const connection = database.raw;
  const timestamp = new Date().toISOString();
  const result: CatalogInitializationResult = {
    presetRowsInserted: 0,
    presetRowsSkipped: 0,
    presetTranslationsUpdated: 0,
    personaRowsInserted: 0,
    personaRowsSkipped: 0,
    scenarioLinksInserted: 0,
    scenarioLinksSkipped: 0,
    defaultScenarioFound: false,
  };

  connection.exec("BEGIN IMMEDIATE");
  try {
    insertPersonaPresets(connection, timestamp, result);
    insertPersonas(connection, timestamp, result);
    appendDefaultScenarioLinks(
      connection,
      new CatalogRepository(database),
      timestamp,
      result,
    );
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

function insertPersonaPresets(
  connection: DatabaseSync,
  timestamp: string,
  result: CatalogInitializationResult,
): void {
  const findExistingById = connection.prepare(
    `SELECT category, value, value_en
     FROM persona_presets
     WHERE id = ?`,
  );
  const findExistingByValue = connection.prepare(
    `SELECT 1 AS present
     FROM persona_presets
     WHERE category = ? AND value = ? COLLATE NOCASE
     LIMIT 1`,
  );
  const backfillEnglishValue = connection.prepare(
    `UPDATE persona_presets
     SET value_en = ?, updated_at = ?
     WHERE id = ? AND length(trim(value_en)) = 0`,
  );
  const positionIsOccupied = connection.prepare(
    `SELECT 1 AS present
     FROM persona_presets
     WHERE category = ? AND position = ?`,
  );
  const findMaximumPosition = connection.prepare(
    `SELECT MAX(position) AS maximum_position
     FROM persona_presets
     WHERE category = ?`,
  );
  const insert = connection.prepare(
    `INSERT INTO persona_presets (
      id, category, value, value_en, position, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const definition of INITIAL_PERSONA_PRESETS) {
    const preset = personaPresetSchema.parse({
      ...definition,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const existingById = findExistingById.get(preset.id) as
      | { category: string; value: string; value_en: string }
      | undefined;
    if (existingById) {
      const stillMatchesSeed =
        existingById.category === preset.category &&
        existingById.value === preset.value;
      if (stillMatchesSeed && existingById.value_en.trim().length === 0) {
        const write = backfillEnglishValue.run(
          preset.valueEn,
          timestamp,
          preset.id,
        );
        result.presetTranslationsUpdated += Number(write.changes);
      }
      result.presetRowsSkipped += 1;
      continue;
    }
    if (findExistingByValue.get(preset.category, preset.value)) {
      result.presetRowsSkipped += 1;
      continue;
    }

    let position = preset.position;
    if (positionIsOccupied.get(preset.category, position)) {
      const row = findMaximumPosition.get(preset.category) as
        | { maximum_position: number | null }
        | undefined;
      position = (row?.maximum_position ?? -1) + 1;
    }
    const write = insert.run(
      preset.id,
      preset.category,
      preset.value,
      preset.valueEn,
      position,
      preset.createdAt,
      preset.updatedAt,
    );
    result.presetRowsInserted += Number(write.changes);
  }
}

function insertPersonas(
  connection: DatabaseSync,
  timestamp: string,
  result: CatalogInitializationResult,
): void {
  const insert = connection.prepare(
    `INSERT OR IGNORE INTO personas (
      id, name, gender, age, occupation, identity, background,
      personality_traits_json, communication_style, behavior_notes,
      motivations_json, concerns_json, voice, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const { id, input } of INITIAL_CATALOG_PERSONAS) {
    const write = insert.run(
      id,
      input.name,
      input.gender,
      input.age,
      input.occupation,
      input.identity,
      input.background,
      JSON.stringify(input.personalityTraits),
      input.communicationStyle,
      input.behaviorNotes,
      JSON.stringify(input.motivations),
      JSON.stringify(input.concerns),
      input.voice,
      timestamp,
      timestamp,
    );
    if (Number(write.changes) === 1) result.personaRowsInserted += 1;
    else result.personaRowsSkipped += 1;
  }
}

function appendDefaultScenarioLinks(
  connection: DatabaseSync,
  repository: CatalogRepository,
  timestamp: string,
  result: CatalogInitializationResult,
): void {
  const scenario = repository.getScenario(DEFAULT_INITIAL_SCENARIO_ID);
  result.defaultScenarioFound = scenario !== null;
  if (!scenario) {
    result.scenarioLinksSkipped += INITIAL_CATALOG_PERSONAS.length;
    return;
  }

  const personaExists = connection.prepare(
    "SELECT 1 AS present FROM personas WHERE id = ?",
  );
  const linkExists = connection.prepare(
    `SELECT 1 AS present
     FROM scenario_personas
     WHERE scenario_id = ? AND persona_id = ?`,
  );
  const maximumPosition = connection
    .prepare(
      `SELECT MAX(position) AS maximum_position
       FROM scenario_personas
       WHERE scenario_id = ?`,
    )
    .get(DEFAULT_INITIAL_SCENARIO_ID) as
    | { maximum_position: number | null }
    | undefined;
  let nextPosition = (maximumPosition?.maximum_position ?? -1) + 1;
  const linkCountRow = connection
    .prepare(
      `SELECT COUNT(*) AS link_count
       FROM scenario_personas
       WHERE scenario_id = ?`,
    )
    .get(DEFAULT_INITIAL_SCENARIO_ID) as { link_count: number };
  let currentLinkCount = linkCountRow.link_count;
  const insertLink = connection.prepare(
    `INSERT INTO scenario_personas (
      scenario_id, persona_id, position, created_at
    ) VALUES (?, ?, ?, ?)`,
  );

  for (const { id } of INITIAL_CATALOG_PERSONAS) {
    if (!personaExists.get(id)) {
      result.scenarioLinksSkipped += 1;
      continue;
    }
    if (linkExists.get(DEFAULT_INITIAL_SCENARIO_ID, id)) {
      result.scenarioLinksSkipped += 1;
      continue;
    }
    if (currentLinkCount >= MAX_SCENARIO_PERSONAS) {
      throw new CatalogInitializationScenarioCapacityError(
        scenario.id,
        scenario.name,
        id,
        currentLinkCount,
        MAX_SCENARIO_PERSONAS,
      );
    }

    const persona = repository.getPersona(id);
    if (!persona) {
      throw new Error(
        `Starter persona "${id}" disappeared before its scenario link was initialized.`,
      );
    }
    const lengthIssue = findRolePlayInstructionsLengthIssue({
      persona,
      scenario,
    });
    if (lengthIssue) {
      throw new CatalogInitializationInstructionsTooLongError(
        persona.id,
        persona.name,
        scenario.id,
        scenario.name,
        lengthIssue.difficulty,
        lengthIssue.actualLength,
        lengthIssue.maximumLength,
      );
    }

    insertLink.run(DEFAULT_INITIAL_SCENARIO_ID, id, nextPosition, timestamp);
    nextPosition += 1;
    currentLinkCount += 1;
    result.scenarioLinksInserted += 1;
  }
}
