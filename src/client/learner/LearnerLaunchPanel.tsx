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
import type { ReactNode } from "react";
import type {
  Difficulty,
  Persona,
  RolePlayCatalog,
  Scenario,
} from "../../shared/role-play-catalog";
import styles from "./LearnerLaunchPanel.module.css";

const { Paragraph, Text, Title } = Typography;

const DIFFICULTY_OPTIONS: Array<{ label: string; value: Difficulty }> = [
  { label: "Easy", value: "easy" },
  { label: "Medium", value: "medium" },
  { label: "Hard", value: "hard" },
];

const DIFFICULTY_DESCRIPTIONS: Record<Difficulty, string> = {
  easy: "客户更愿意配合，适合熟悉流程和建立信心。",
  medium: "客户会逐步提供信息，并提出符合真实业务的异议。",
  hard: "客户更谨慎且要求更高，需要扎实的探索问题和推进能力。",
};

const GENDER_LABELS: Record<Persona["gender"], string> = {
  female: "女",
  male: "男",
  non_binary: "非二元",
  unspecified: "未指定",
};

const PACE_LABELS: Record<Scenario["voiceBehavior"]["speakingPace"], string> = {
  slow: "偏慢",
  normal: "自然",
  fast: "偏快",
};

const INTERRUPT_LABELS: Record<
  Scenario["voiceBehavior"]["interruptFrequency"],
  string
> = {
  low: "耐心，较少挑战",
  medium: "偶尔简短插话",
  high: "频繁、快速挑战（仅在角色回应时）",
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
  return (
    <Card
      className={styles.summaryCard}
      size="small"
      title={
        <Space size={8}>
          <AimOutlined />
          <span>场景概览</span>
        </Space>
      }
    >
      <Title level={4}>{scenario.name}</Title>
      <Paragraph className={styles.description}>{scenario.description}</Paragraph>

      <SummaryTags
        icon={<AimOutlined />}
        label="本次目标"
        values={scenario.goals}
        color="green"
      />
      <SummaryTags
        icon={<BulbOutlined />}
        label="建议练习重点"
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
            label: "语气",
            children: scenario.voiceBehavior.toneStyle,
          },
          {
            key: "pace",
            label: "语速",
            children: PACE_LABELS[scenario.voiceBehavior.speakingPace],
          },
          {
            key: "interruptions",
            label: "插话 / 挑战倾向",
            children:
              INTERRUPT_LABELS[scenario.voiceBehavior.interruptFrequency],
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
  const basicDetails = [
    GENDER_LABELS[persona.gender],
    persona.age === null ? null : `${persona.age} 岁`,
    persona.occupation || null,
  ].filter((value): value is string => value !== null);

  return (
    <Card
      className={styles.summaryCard}
      size="small"
      title={
        <Space size={8}>
          <UserOutlined />
          <span>客户角色</span>
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
        label="性格特点"
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
            label: "沟通方式",
            children: persona.communicationStyle,
          },
          ...(persona.behaviorNotes
            ? [
                {
                  key: "behavior",
                  label: "行为设定",
                  children: persona.behaviorNotes,
                },
              ]
            : []),
          {
            key: "voice",
            label: "音色",
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
  themeButton,
  onOpenAdmin,
}: LearnerLaunchPanelProps) {
  const selectedScenario =
    catalog?.scenarios.find(({ id }) => id === selectedScenarioId) ?? null;
  const allowedPersonaIds = new Set(
    selectedScenario?.allowedPersonaIds ?? [],
  );
  const compatiblePersonas = selectedScenario
    ? (catalog?.personas.filter(({ id }) => allowedPersonaIds.has(id)) ?? [])
    : [];
  const selectedPersona =
    compatiblePersonas.find(({ id }) => id === selectedPersonaId) ?? null;
  const catalogIsEmpty =
    !catalog || catalog.scenarios.length === 0 || catalog.personas.length === 0;
  const canStart =
    !loading &&
    !startDisabled &&
    selectedScenario !== null &&
    selectedPersona !== null;

  const scenarioOptions = (catalog?.scenarios ?? []).map((scenario) => ({
    label: scenario.name,
    value: scenario.id,
    searchText: [scenario.name, scenario.description, ...scenario.goals]
      .join(" ")
      .toLocaleLowerCase(),
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
      .toLocaleLowerCase(),
  }));

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
              销售实战训练
            </Text>
          </div>
        </Flex>
        <Space size={8}>
          {themeButton}
          <Button
            disabled={loading || isStarting}
            icon={<SettingOutlined />}
            onClick={onOpenAdmin}
          >
            管理控制台
          </Button>
        </Space>
      </header>

      <main className={styles.content}>
        <div className={styles.introduction}>
          <Tag color="green">VOICE ROLE PLAY</Tag>
          <Title id="learner-launch-title">准备开始一次销售对练</Title>
          <Paragraph type="secondary">
            选择训练场景、客户角色和难度，AI 客户会根据设定与你进行实时语音对话。
          </Paragraph>
        </div>

        <Card className={styles.launchCard}>
          {error && (
            <Alert
              className={styles.pageAlert}
              type="error"
              showIcon
              title="当前无法开始训练"
              description={error}
            />
          )}
          {loading ? (
            <div className={styles.loadingState}>
              <Skeleton active paragraph={{ rows: 7 }} />
              <Text type="secondary">正在加载训练配置…</Text>
            </div>
          ) : catalogIsEmpty ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有可供训练的场景和角色"
            >
              <Button icon={<SettingOutlined />} onClick={onOpenAdmin}>
                前往管理控制台创建
              </Button>
            </Empty>
          ) : (
            <>
              <div className={styles.selectionGrid}>
                <label className={styles.field}>
                  <Text strong>1. 选择训练场景</Text>
                  <Select
                    aria-label="选择训练场景"
                    className={styles.select}
                    showSearch
                    disabled={isStarting}
                    placeholder="搜索并选择场景"
                    value={selectedScenario?.id}
                    options={scenarioOptions}
                    optionFilterProp="searchText"
                    onChange={onScenarioChange}
                  />
                </label>

                <label className={styles.field}>
                  <Text strong>2. 选择客户角色</Text>
                  <Select
                    aria-label="选择客户角色"
                    className={styles.select}
                    showSearch
                    disabled={isStarting || !selectedScenario}
                    placeholder={
                      selectedScenario
                        ? "搜索并选择兼容角色"
                        : "请先选择训练场景"
                    }
                    value={selectedPersona?.id}
                    options={personaOptions}
                    optionFilterProp="searchText"
                    onChange={onPersonaChange}
                    notFoundContent="此场景没有匹配的角色"
                  />
                </label>
              </div>

              {selectedScenario && compatiblePersonas.length === 0 && (
                <Alert
                  className={styles.compatibilityAlert}
                  type="warning"
                  showIcon
                  title="当前场景没有可用角色"
                  description="请在管理控制台中为该场景关联至少一个角色。"
                  action={
                    <Button size="small" onClick={onOpenAdmin}>
                      去关联
                    </Button>
                  }
                />
              )}

              <section className={styles.difficultySection}>
                <div>
                  <Text strong>3. 选择训练难度</Text>
                  <Paragraph type="secondary">
                    {DIFFICULTY_DESCRIPTIONS[difficulty]}
                  </Paragraph>
                </div>
                <Segmented
                  aria-label="选择训练难度"
                  block
                  disabled={isStarting}
                  options={DIFFICULTY_OPTIONS}
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
                  对练开始后，请按住底部按钮与客户说话。
                </Text>
                <Button
                  type="primary"
                  size="large"
                  icon={<PlayCircleFilled />}
                  disabled={!canStart}
                  loading={isStarting}
                  onClick={() => void onStart()}
                >
                  开始语音对练
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
