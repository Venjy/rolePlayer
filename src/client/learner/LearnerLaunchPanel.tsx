import {
  AimOutlined,
  AudioOutlined,
  BulbOutlined,
  CustomerServiceOutlined,
  PlayCircleFilled,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Segmented,
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
import { localizeCatalog } from "../catalog/catalog-localization";
import {
  LanguageToggleButton,
  useI18n,
  type LocalizedText,
} from "../i18n";
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

const PACE_LABELS: Record<
  Scenario["voiceBehavior"]["speakingPace"],
  LocalizedText
> = {
  slow: { en: "Slower", zh: "偏慢" },
  normal: { en: "Natural", zh: "自然" },
  fast: { en: "Faster", zh: "偏快" },
};

const INTERRUPT_LABELS: Record<
  Scenario["voiceBehavior"]["interruptFrequency"],
  LocalizedText
> = {
  low: { en: "Patient, with few challenges", zh: "耐心，较少挑战" },
  medium: { en: "Occasional brief interjections", zh: "偶尔简短插话" },
  high: {
    en: "Frequent, rapid challenges (during the role's responses only)",
    zh: "频繁、快速挑战（仅在角色回应时）",
  },
};

export interface LearnerLaunchPanelProps {
  catalog: RolePlayCatalog | null;
  loading: boolean;
  error: string | null;
  selectedScenarioId: string | null;
  selectedPersonaId: string | null;
  difficulty: Difficulty;
  onScenarioChange: (scenarioId: string) => void;
  onPersonaChange: (personaId: string) => void;
  onDifficultyChange: (difficulty: Difficulty) => void;
  onStart: () => void | Promise<void>;
  isStarting: boolean;
  startDisabled?: boolean;
  historyButton: ReactNode;
  themeButton: ReactNode;
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

      <Descriptions
        className={styles.compactDescriptions}
        column={1}
        size="small"
        items={[
          {
            key: "tone",
            label: t({ en: "Tone", zh: "语气" }),
            children: scenario.voiceBehavior.toneStyle,
          },
          {
            key: "pace",
            label: t({ en: "Pace", zh: "语速" }),
            children: t(PACE_LABELS[scenario.voiceBehavior.speakingPace]),
          },
          {
            key: "interruptions",
            label: t({
              en: "Interjection / challenge tendency",
              zh: "插话 / 挑战倾向",
            }),
            children: t(
              INTERRUPT_LABELS[scenario.voiceBehavior.interruptFrequency],
            ),
          },
        ]}
      />
    </Card>
  );
}

interface PersonaSummaryProps {
  persona: Persona;
}

function PersonaSummary({ persona }: PersonaSummaryProps) {
  const { t } = useI18n();
  const basicDetails = [
    t(GENDER_LABELS[persona.gender]),
    persona.age === null
      ? null
      : t({ en: "{age} years old", zh: "{age} 岁" }, { age: persona.age }),
    persona.occupation || null,
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

      <Paragraph className={styles.identity}>{persona.identity}</Paragraph>

      <SummaryTags
        icon={<UserOutlined />}
        label={t({ en: "Personality traits", zh: "性格特点" })}
        values={persona.personalityTraits}
        color="purple"
      />

      <Descriptions
        className={styles.compactDescriptions}
        column={1}
        size="small"
        items={[
          {
            key: "communication",
            label: t({ en: "Communication", zh: "沟通方式" }),
            children: persona.communicationStyle,
          },
          ...(persona.behaviorNotes
            ? [
                {
                  key: "behavior",
                  label: t({ en: "Behavior", zh: "行为设定" }),
                  children: persona.behaviorNotes,
                },
              ]
            : []),
          {
            key: "voice",
            label: t({ en: "Voice", zh: "音色" }),
            children: (
              <Space size={6}>
                <AudioOutlined />
                <span>{persona.voice}</span>
              </Space>
            ),
          },
        ]}
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
  themeButton,
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
  const catalogIsEmpty =
    !localizedCatalog ||
    localizedCatalog.scenarios.length === 0 ||
    localizedCatalog.personas.length === 0;
  const canStart =
    !loading &&
    !startDisabled &&
    selectedScenario !== null &&
    selectedPersona !== null;

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
      persona.identity,
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
      <header className={styles.header}>
        <Flex align="center" gap={10} className={styles.brand}>
          <Avatar icon={<CustomerServiceOutlined />} />
          <div>
            <Text strong>AI Role Player</Text>
            <Text className={styles.brandSubtitle} type="secondary">
              {t({ en: "Sales practice training", zh: "销售实战训练" })}
            </Text>
          </div>
        </Flex>
        <Space size={8}>
          {historyButton}
          <span className={styles.languageToggle}>
            <LanguageToggleButton />
          </span>
          {themeButton}
          <Button
            className={styles.adminButton}
            aria-label={t({
              en: "Open Admin Console",
              zh: "打开管理控制台",
            })}
            disabled={loading || isStarting}
            icon={<SettingOutlined />}
            onClick={onOpenAdmin}
          >
            <span className={styles.buttonLabel}>
              {t({ en: "Admin Console", zh: "管理控制台" })}
            </span>
          </Button>
        </Space>
      </header>

      <main className={styles.content}>
        <div className={styles.introduction}>
          <Tag color="green">VOICE ROLE PLAY</Tag>
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
                  <Paragraph type="secondary">
                    {t(DIFFICULTY_DESCRIPTIONS[difficulty])}
                  </Paragraph>
                </div>
                <Segmented
                  aria-label={t({
                    en: "Choose a training difficulty",
                    zh: "选择训练难度",
                  })}
                  block
                  disabled={isStarting}
                  options={difficultyOptions}
                  value={difficulty}
                  onChange={(value) =>
                    onDifficultyChange(value as Difficulty)
                  }
                />
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
            </>
          )}
        </Card>
      </main>
    </section>
  );
}
