import {
  AimOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CustomerServiceOutlined,
  MessageOutlined,
  PlayCircleFilled,
  ProfileOutlined,
  RiseOutlined,
  SettingOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Flex,
  Radio,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { useMemo, type ReactNode } from "react";
import type {
  Difficulty,
  Persona,
  RolePlayCatalog,
  Scenario,
} from "../../shared/role-play-catalog";
import { MAX_REALTIME_INSTRUCTIONS_LENGTH } from "../../shared/realtime-protocol";
import { compileRolePlayInstructions } from "../../shared/role-play-instructions";
import { localizeCatalog } from "../catalog/catalog-localization";
import { useI18n, type LocalizedText } from "../i18n";
import styles from "./LearnerLaunchPanel.module.css";

const { Paragraph, Text, Title } = Typography;

const DIFFICULTY_LABELS: Record<Difficulty, LocalizedText> = {
  easy: { en: "Easy", zh: "简单" },
  medium: { en: "Medium", zh: "中等" },
  hard: { en: "Hard", zh: "困难" },
};

const DIFFICULTY_DESCRIPTIONS: Record<Difficulty, LocalizedText> = {
  easy: {
    en: "The customer is more cooperative, making this ideal for learning the flow and building confidence.",
    zh: "客户更愿意配合，适合熟悉流程和建立信心。",
  },
  medium: {
    en: "The customer reveals information gradually and raises realistic business objections.",
    zh: "客户会逐步提供信息，并提出符合真实业务的异议。",
  },
  hard: {
    en: "The customer is cautious and demanding, requiring strong discovery and progression skills.",
    zh: "客户更谨慎且要求更高，需要扎实的探索问题和推进能力。",
  },
};

const GENDER_LABELS: Record<Persona["gender"], LocalizedText> = {
  female: { en: "Female", zh: "女" },
  male: { en: "Male", zh: "男" },
  non_binary: { en: "Non-binary", zh: "非二元" },
  unspecified: { en: "Not specified", zh: "未指定" },
};

export interface LearnerLaunchPanelProps {
  catalog: RolePlayCatalog | null;
  loading: boolean;
  error: string | null;
  selectedScenarioId: number | null;
  selectedPersonaId: number | null;
  difficulty: Difficulty;
  onScenarioChange: (scenarioId: number) => void;
  onPersonaChange: (personaId: number) => void;
  onDifficultyChange: (difficulty: Difficulty) => void;
  onStart: () => void | Promise<void>;
  isStarting: boolean;
  startDisabled?: boolean;
  historyButton: ReactNode;
  onOpenAdmin: () => void;
}

interface SummaryTagsProps {
  icon: ReactNode;
  label: string;
  values: readonly string[];
  color?: string;
}

function SummaryTags({
  icon,
  label,
  values,
  color = "default",
}: SummaryTagsProps) {
  if (values.length === 0) return null;

  return (
    <section className={styles.summarySection} aria-label={label}>
      <Text className={styles.summaryLabel} type="secondary">
        {icon}
        {label}
      </Text>
      <Flex wrap gap={6}>
        {values.map((value, index) => (
          <Tag key={`${index}:${value}`} color={color}>
            {value}
          </Tag>
        ))}
      </Flex>
    </section>
  );
}

interface SummaryTextProps {
  icon: ReactNode;
  label: string;
  value: string;
}

function SummaryText({ icon, label, value }: SummaryTextProps) {
  if (!value.trim()) return null;

  return (
    <section className={styles.summarySection} aria-label={label}>
      <Text className={styles.summaryLabel} type="secondary">
        {icon}
        {label}
      </Text>
      <Paragraph className={styles.summaryValue}>{value}</Paragraph>
    </section>
  );
}

interface SummaryListProps {
  icon: ReactNode;
  label: string;
  values: readonly string[];
}

function SummaryList({ icon, label, values }: SummaryListProps) {
  if (values.length === 0) return null;

  return (
    <section className={styles.summarySection} aria-label={label}>
      <Text className={styles.summaryLabel} type="secondary">
        {icon}
        {label}
      </Text>
      <ul className={styles.summaryList}>
        {values.map((value, index) => (
          <li key={`${index}:${value}`}>
            <CheckCircleOutlined aria-hidden="true" />
            <span>{value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ScenarioSummaryProps {
  scenario: Scenario;
}

function ScenarioSummary({ scenario }: ScenarioSummaryProps) {
  const { t } = useI18n();

  return (
    <Card
      className={styles.summaryCard}
      size="small"
      title={
        <Space size={8}>
          <AimOutlined />
          <span>{t({ en: "Scenario overview", zh: "场景概览" })}</span>
        </Space>
      }
    >
      <Title level={4}>{scenario.name}</Title>
      <Paragraph className={styles.description}>{scenario.description}</Paragraph>

      <SummaryTags
        icon={<AimOutlined />}
        label={t({ en: "Goals", zh: "本次目标" })}
        values={scenario.goals}
        color="green"
      />
      <SummaryTags
        icon={<BulbOutlined />}
        label={t({ en: "Suggested focus", zh: "建议练习重点" })}
        values={scenario.suggestedSkillFocus}
        color="blue"
      />
      <SummaryList
        icon={<CheckCircleOutlined />}
        label={t({ en: "Success looks like", zh: "达成标准" })}
        values={scenario.successCriteria}
      />
    </Card>
  );
}

interface InstructionsPreviewProps {
  instructions: string;
  tooLong: boolean;
}

function InstructionsPreview({
  instructions,
  tooLong,
}: InstructionsPreviewProps) {
  const { t } = useI18n();

  return (
    <section
      className={styles.instructionsSection}
      aria-label={t({
        en: "Model Instructions preview",
        zh: "模型 Instructions 预览",
      })}
    >
      {tooLong && (
        <Alert
          className={styles.instructionsAlert}
          type="error"
          showIcon
          title={t({
            en: "The Instructions exceed the Qwen realtime session limit",
            zh: "Instructions 超出 Qwen 实时会话长度限制",
          })}
          description={t({
            en: "Shorten the selected scenario or customer role before starting this role-play.",
            zh: "请先缩短所选场景或客户角色的配置，再开始对练。",
          })}
        />
      )}
      <Card
        size="small"
        title={
          <Flex align="center" justify="space-between" gap={12}>
            <Text strong copyable={{ text: instructions }}>
              {t({
                en: "Model Instructions preview",
                zh: "模型 Instructions 预览",
              })}
            </Text>
            <Tag color={tooLong ? "error" : "default"}>
              {instructions.length}/{MAX_REALTIME_INSTRUCTIONS_LENGTH}
            </Tag>
          </Flex>
        }
      >
        <Paragraph className={styles.instructionsPreview}>
          {instructions}
        </Paragraph>
      </Card>
    </section>
  );
}

function PersonaSummary({ persona }: { persona: Persona }) {
  const { t } = useI18n();
  const basicDetails = [
    t(GENDER_LABELS[persona.gender]),
    persona.age === null
      ? null
      : t({ en: "{age} years old", zh: "{age} 岁" }, { age: persona.age }),
  ].filter((value): value is string => value !== null);

  return (
    <Card
      className={styles.summaryCard}
      size="small"
      title={
        <Space size={8}>
          <UserOutlined />
          <span>{t({ en: "Customer role", zh: "客户角色" })}</span>
        </Space>
      }
    >
      <Flex align="center" gap={12}>
        <Avatar size={44} icon={<CustomerServiceOutlined />} />
        <div className={styles.personaHeading}>
          <Title level={4}>{persona.name}</Title>
          <Text type="secondary">{basicDetails.join(" · ")}</Text>
        </div>
      </Flex>

      <Paragraph className={styles.identity}>{persona.occupation}</Paragraph>

      <SummaryText
        icon={<ProfileOutlined />}
        label={t({ en: "Background", zh: "角色背景" })}
        value={persona.background}
      />

      <SummaryTags
        icon={<UserOutlined />}
        label={t({ en: "Personality traits", zh: "性格特点" })}
        values={persona.personalityTraits}
        color="purple"
      />

      <SummaryText
        icon={<MessageOutlined />}
        label={t({ en: "Communication style", zh: "沟通方式" })}
        value={persona.communicationStyle}
      />
      <SummaryTags
        icon={<RiseOutlined />}
        label={t({ en: "What matters to them", zh: "角色动机" })}
        values={persona.motivations}
        color="green"
      />
      <SummaryTags
        icon={<WarningOutlined />}
        label={t({ en: "Likely concerns", zh: "可能的顾虑与异议" })}
        values={persona.concerns}
        color="orange"
      />
    </Card>
  );
}

export function LearnerLaunchPanel({
  catalog,
  loading,
  error,
  selectedScenarioId,
  selectedPersonaId,
  difficulty,
  onScenarioChange,
  onPersonaChange,
  onDifficultyChange,
  onStart,
  isStarting,
  startDisabled = false,
  historyButton,
  onOpenAdmin,
}: LearnerLaunchPanelProps) {
  const { locale, t } = useI18n();
  const localizedCatalog = useMemo(
    () => (catalog ? localizeCatalog(catalog, locale) : null),
    [catalog, locale],
  );
  const selectedScenario =
    localizedCatalog?.scenarios.find(({ id }) => id === selectedScenarioId) ??
    null;
  const allowedPersonaIds = new Set(selectedScenario?.allowedPersonaIds ?? []);
  const compatiblePersonas = selectedScenario
    ? (localizedCatalog?.personas.filter(({ id }) =>
        allowedPersonaIds.has(id),
      ) ?? [])
    : [];
  const selectedPersona =
    compatiblePersonas.find(({ id }) => id === selectedPersonaId) ?? null;
  const instructions = selectedScenario && selectedPersona
    ? compileRolePlayInstructions({
        persona: selectedPersona,
        scenario: selectedScenario,
        difficulty,
        locale,
      })
    : "";
  const instructionsTooLong =
    instructions.length > MAX_REALTIME_INSTRUCTIONS_LENGTH;
  const catalogIsEmpty =
    !localizedCatalog ||
    localizedCatalog.scenarios.length === 0 ||
    localizedCatalog.personas.length === 0;
  const canStart =
    !loading &&
    !startDisabled &&
    selectedScenario !== null &&
    selectedPersona !== null &&
    !instructionsTooLong;

  const lowerCaseLocale = locale === "zh" ? "zh-CN" : "en-US";
  const scenarioOptions = (localizedCatalog?.scenarios ?? []).map((scenario) => ({
    label: scenario.name,
    value: scenario.id,
    searchText: [scenario.name, scenario.description, ...scenario.goals]
      .join(" ")
      .toLocaleLowerCase(lowerCaseLocale),
  }));
  const personaOptions = compatiblePersonas.map((persona) => ({
    label: persona.name,
    value: persona.id,
    searchText: [
      persona.name,
      persona.occupation,
      ...persona.personalityTraits,
    ]
      .join(" ")
      .toLocaleLowerCase(lowerCaseLocale),
  }));
  const difficultyOptions = (
    Object.keys(DIFFICULTY_LABELS) as Difficulty[]
  ).map((value) => ({ label: t(DIFFICULTY_LABELS[value]), value }));

  return (
    <section
      className={styles.root}
      aria-labelledby="learner-launch-title"
      aria-busy={loading || isStarting}
    >
      <main className={styles.content}>
        <div className={styles.mobileHistoryRow}>{historyButton}</div>
        <div className={styles.introduction}>
          <Title id="learner-launch-title">
            {t({
              en: "Get ready for a sales role-play",
              zh: "准备开始一次销售对练",
            })}
          </Title>
          <Paragraph type="secondary">
            {t({
              en: "Choose a scenario, customer role, and difficulty. Your AI customer will follow those settings in a realtime voice conversation.",
              zh: "选择训练场景、客户角色和难度，AI 客户会根据设定与你进行实时语音对话。",
            })}
          </Paragraph>
        </div>

        <Card className={styles.launchCard}>
          {error && (
            <Alert
              className={styles.pageAlert}
              type="error"
              showIcon
              title={t({
                en: "Training can't start yet",
                zh: "当前无法开始训练",
              })}
              description={error}
            />
          )}
          {loading ? (
            <div className={styles.loadingState}>
              <Skeleton active paragraph={{ rows: 7 }} />
              <Text type="secondary">
                {t({
                  en: "Loading training configuration…",
                  zh: "正在加载训练配置…",
                })}
              </Text>
            </div>
          ) : catalogIsEmpty ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t({
                en: "No scenarios or roles are available for training yet",
                zh: "还没有可供训练的场景和角色",
              })}
            >
              <Button icon={<SettingOutlined />} onClick={onOpenAdmin}>
                {t({
                  en: "Create them in Admin Console",
                  zh: "前往管理控制台创建",
                })}
              </Button>
            </Empty>
          ) : (
            <>
              <div className={styles.selectionGrid}>
                <label className={styles.field}>
                  <Text strong>
                    {t({ en: "1. Choose a scenario", zh: "1. 选择训练场景" })}
                  </Text>
                  <Select
                    aria-label={t({
                      en: "Choose a training scenario",
                      zh: "选择训练场景",
                    })}
                    className={styles.select}
                    showSearch
                    disabled={isStarting}
                    placeholder={t({
                      en: "Search and choose a scenario",
                      zh: "搜索并选择场景",
                    })}
                    value={selectedScenario?.id}
                    options={scenarioOptions}
                    optionFilterProp="searchText"
                    onChange={onScenarioChange}
                  />
                </label>

                <label className={styles.field}>
                  <Text strong>
                    {t({
                      en: "2. Choose a customer role",
                      zh: "2. 选择客户角色",
                    })}
                  </Text>
                  <Select
                    aria-label={t({
                      en: "Choose a customer role",
                      zh: "选择客户角色",
                    })}
                    className={styles.select}
                    showSearch
                    disabled={isStarting || !selectedScenario}
                    placeholder={
                      selectedScenario
                        ? t({
                            en: "Search and choose a compatible role",
                            zh: "搜索并选择兼容角色",
                          })
                        : t({
                            en: "Choose a scenario first",
                            zh: "请先选择训练场景",
                          })
                    }
                    value={selectedPersona?.id}
                    options={personaOptions}
                    optionFilterProp="searchText"
                    onChange={onPersonaChange}
                    notFoundContent={t({
                      en: "No matching roles for this scenario",
                      zh: "此场景没有匹配的角色",
                    })}
                  />
                </label>
              </div>

              {selectedScenario && compatiblePersonas.length === 0 && (
                <Alert
                  className={styles.compatibilityAlert}
                  type="warning"
                  showIcon
                  title={t({
                    en: "This scenario has no available roles",
                    zh: "当前场景没有可用角色",
                  })}
                  description={t({
                    en: "Associate at least one role with this scenario in Admin Console.",
                    zh: "请在管理控制台中为该场景关联至少一个角色。",
                  })}
                  action={
                    <Button size="small" onClick={onOpenAdmin}>
                      {t({ en: "Associate roles", zh: "去关联" })}
                    </Button>
                  }
                />
              )}

              <section className={styles.difficultySection}>
                <div>
                  <Text strong>
                    {t({
                      en: "3. Choose a difficulty",
                      zh: "3. 选择训练难度",
                    })}
                  </Text>
                  <br/>
                  <Radio.Group
                    aria-label={t({
                      en: "Choose a training difficulty",
                      zh: "选择训练难度",
                    })}
                    buttonStyle="solid"
                    className={styles.difficultyOptions}
                    disabled={isStarting}
                    optionType="button"
                    options={difficultyOptions}
                    value={difficulty}
                    onChange={(event) =>
                      onDifficultyChange(event.target.value as Difficulty)
                    }
                  />
                  <Paragraph type="secondary">
                    {t(DIFFICULTY_DESCRIPTIONS[difficulty])}
                  </Paragraph>
                </div>
              </section>

              <Flex
                className={styles.startArea}
                align="center"
                justify="space-between"
                gap={16}
              >
                <Text type="secondary">
                  {t({
                    en: "Once the role-play starts, hold the bottom button to speak with the customer.",
                    zh: "对练开始后，请按住底部按钮与客户说话。",
                  })}
                </Text>
                <Button
                  type="primary"
                  size="large"
                  icon={<PlayCircleFilled />}
                  disabled={!canStart}
                  loading={isStarting}
                  onClick={() => void onStart()}
                >
                  {t({ en: "Start voice role-play", zh: "开始语音对练" })}
                </Button>
              </Flex>

              {(selectedScenario || selectedPersona) && (
                <div className={styles.summaryGrid}>
                  {selectedScenario && (
                    <ScenarioSummary scenario={selectedScenario} />
                  )}
                  {selectedPersona && (
                    <PersonaSummary persona={selectedPersona} />
                  )}
                </div>
              )}

              {selectedScenario && selectedPersona && (
                <InstructionsPreview
                  instructions={instructions}
                  tooLong={instructionsTooLong}
                />
              )}
            </>
          )}
        </Card>
      </main>
    </section>
  );
}
