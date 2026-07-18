import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Pagination,
  Popconfirm,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type {
  Persona,
  PersonaInput,
  RolePlayCatalog,
  Scenario,
  ScenarioInput,
} from "../../shared/role-play-catalog";
import { includesSearchText } from "./admin-options";
import { PersonaEditorDrawer } from "./PersonaEditorDrawer";
import { ScenarioEditorDrawer } from "./ScenarioEditorDrawer";
import styles from "./AdminConsole.module.css";

export interface AdminConsoleProps {
  catalog: RolePlayCatalog;
  busy: boolean;
  error?: string;
  themeButton: ReactNode;
  onExit: () => void;
  onCreatePersona: (input: PersonaInput) => Promise<void>;
  onUpdatePersona: (id: string, input: PersonaInput) => Promise<void>;
  onDeletePersona: (id: string) => Promise<void>;
  onCreateScenario: (input: ScenarioInput) => Promise<void>;
  onUpdateScenario: (id: string, input: ScenarioInput) => Promise<void>;
  onDeleteScenario: (id: string) => Promise<void>;
}

type PersonaDrawerState = { mode: "create" } | { mode: "edit"; persona: Persona };
type ScenarioDrawerState =
  | { mode: "create" }
  | { mode: "edit"; scenario: Scenario };

const PAGE_SIZE = 9;

const GENDER_LABELS: Record<Persona["gender"], string> = {
  female: "女",
  male: "男",
  non_binary: "非二元",
  unspecified: "未指定",
};

const INTERRUPT_LABELS: Record<
  Scenario["voiceBehavior"]["interruptFrequency"],
  string
> = {
  low: "较少挑战",
  medium: "偶尔插话",
  high: "频繁挑战",
};

function PersonaCard({
  persona,
  busy,
  scenarioNames,
  onEdit,
  onDelete,
}: {
  persona: Persona;
  busy: boolean;
  scenarioNames: string[];
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <Card className={styles.entityCard} size="small">
      <div className={styles.cardHeader}>
        <Space align="start">
          <span aria-hidden className={styles.entityIcon}>
            <UserOutlined />
          </span>
          <div>
            <Typography.Title className={styles.cardTitle} level={4}>
              {persona.name}
            </Typography.Title>
            <Typography.Text type="secondary">
              {[persona.occupation, persona.age ? `${persona.age} 岁` : undefined]
                .filter(Boolean)
                .join(" · ") || "尚未填写职业和年龄"}
            </Typography.Text>
          </div>
        </Space>
        <Tag>{GENDER_LABELS[persona.gender]}</Tag>
      </div>

      <Typography.Paragraph className={styles.cardDescription} ellipsis={{ rows: 2 }}>
        {persona.identity}
      </Typography.Paragraph>
      <Space className={styles.tagCloud} size={[4, 6]} wrap>
        {persona.personalityTraits.slice(0, 4).map((trait) => (
          <Tag key={trait}>{trait}</Tag>
        ))}
        {persona.personalityTraits.length > 4 ? (
          <Tag>+{persona.personalityTraits.length - 4}</Tag>
        ) : null}
      </Space>

      <div className={styles.cardFooter}>
        <Typography.Text type="secondary">
          可用于 {scenarioNames.length} 个场景
        </Typography.Text>
        <Space size="small">
          <Button
            aria-label={`编辑角色 ${persona.name}`}
            disabled={busy}
            icon={<EditOutlined />}
            onClick={onEdit}
            size="small"
          >
            编辑
          </Button>
          {scenarioNames.length > 0 ? (
            <Tooltip
              title={`请先在这些场景中移除该角色：${scenarioNames.join("、")}`}
            >
              <span>
                <Button
                  aria-label={`无法删除角色 ${persona.name}，仍有关联场景`}
                  danger
                  disabled
                  icon={<DeleteOutlined />}
                  size="small"
                  type="text"
                />
              </span>
            </Tooltip>
          ) : (
            <Popconfirm
              cancelText="取消"
              description="删除后无法恢复。"
              okButtonProps={{ danger: true }}
              okText="删除"
              onConfirm={onDelete}
              title={`删除角色“${persona.name}”？`}
            >
              <Button
                aria-label={`删除角色 ${persona.name}`}
                danger
                disabled={busy}
                icon={<DeleteOutlined />}
                size="small"
                type="text"
              />
            </Popconfirm>
          )}
        </Space>
      </div>
    </Card>
  );
}

function ScenarioCard({
  scenario,
  busy,
  personaNames,
  onEdit,
  onDelete,
}: {
  scenario: Scenario;
  busy: boolean;
  personaNames: string[];
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <Card className={styles.entityCard} size="small">
      <div className={styles.cardHeader}>
        <div>
          <Typography.Title className={styles.cardTitle} level={4}>
            {scenario.name}
          </Typography.Title>
          <Typography.Text type="secondary">
            {INTERRUPT_LABELS[scenario.voiceBehavior.interruptFrequency]} ·
            {" "}
            {scenario.voiceBehavior.toneStyle}
          </Typography.Text>
        </div>
        <Badge
          count={`${scenario.allowedPersonaIds.length} 角色`}
          showZero
          color="blue"
        />
      </div>

      <Typography.Paragraph className={styles.cardDescription} ellipsis={{ rows: 2 }}>
        {scenario.description}
      </Typography.Paragraph>
      <Space className={styles.tagCloud} size={[4, 6]} wrap>
        {scenario.suggestedSkillFocus.slice(0, 3).map((skill) => (
          <Tag color="processing" key={skill}>
            {skill}
          </Tag>
        ))}
        {scenario.suggestedSkillFocus.length > 3 ? (
          <Tag>+{scenario.suggestedSkillFocus.length - 3}</Tag>
        ) : null}
      </Space>

      <div className={styles.cardFooter}>
        <Tooltip
          title={personaNames.length > 0 ? personaNames.join("、") : "没有可用角色"}
        >
          <Typography.Text className={styles.personaSummary} type="secondary">
            {personaNames.length > 0
              ? `角色：${personaNames.slice(0, 2).join("、")}${personaNames.length > 2 ? "…" : ""}`
              : "没有可用角色"}
          </Typography.Text>
        </Tooltip>
        <Space size="small">
          <Button
            aria-label={`编辑场景 ${scenario.name}`}
            disabled={busy}
            icon={<EditOutlined />}
            onClick={onEdit}
            size="small"
          >
            编辑
          </Button>
          <Popconfirm
            cancelText="取消"
            description="删除后无法恢复。"
            okButtonProps={{ danger: true }}
            okText="删除"
            onConfirm={onDelete}
            title={`删除场景“${scenario.name}”？`}
          >
            <Button
              aria-label={`删除场景 ${scenario.name}`}
              danger
              disabled={busy}
              icon={<DeleteOutlined />}
              size="small"
              type="text"
            />
          </Popconfirm>
        </Space>
      </div>
    </Card>
  );
}

export function AdminConsole({
  catalog,
  busy,
  error,
  themeButton,
  onExit,
  onCreatePersona,
  onUpdatePersona,
  onDeletePersona,
  onCreateScenario,
  onUpdateScenario,
  onDeleteScenario,
}: AdminConsoleProps) {
  const [personaQuery, setPersonaQuery] = useState("");
  const [scenarioQuery, setScenarioQuery] = useState("");
  const [personaPage, setPersonaPage] = useState(1);
  const [scenarioPage, setScenarioPage] = useState(1);
  const [personaDrawer, setPersonaDrawer] = useState<PersonaDrawerState>();
  const [scenarioDrawer, setScenarioDrawer] = useState<ScenarioDrawerState>();

  const personas = useMemo(
    () =>
      catalog.personas.filter((persona) =>
        includesSearchText(
          personaQuery,
          persona.name,
          persona.occupation,
          persona.identity,
          persona.personalityTraits,
        ),
      ),
    [catalog.personas, personaQuery],
  );
  const scenarios = useMemo(
    () =>
      catalog.scenarios.filter((scenario) =>
        includesSearchText(
          scenarioQuery,
          scenario.name,
          scenario.description,
          scenario.goals,
          scenario.suggestedSkillFocus,
        ),
      ),
    [catalog.scenarios, scenarioQuery],
  );
  const visiblePersonaPage = Math.min(
    personaPage,
    Math.max(1, Math.ceil(personas.length / PAGE_SIZE)),
  );
  const visibleScenarioPage = Math.min(
    scenarioPage,
    Math.max(1, Math.ceil(scenarios.length / PAGE_SIZE)),
  );
  const pagePersonas = personas.slice(
    (visiblePersonaPage - 1) * PAGE_SIZE,
    visiblePersonaPage * PAGE_SIZE,
  );
  const pageScenarios = scenarios.slice(
    (visibleScenarioPage - 1) * PAGE_SIZE,
    visibleScenarioPage * PAGE_SIZE,
  );

  const personaPanel = (
    <section aria-label="角色管理" className={styles.panel}>
      <div className={styles.toolbar}>
        <Input
          allowClear
          aria-label="搜索角色"
          onChange={(event) => {
            setPersonaQuery(event.target.value);
            setPersonaPage(1);
          }}
          placeholder="按名字、职业、身份或性格搜索"
          prefix={<SearchOutlined />}
          value={personaQuery}
        />
        <Button
          disabled={busy}
          icon={<PlusOutlined />}
          onClick={() => setPersonaDrawer({ mode: "create" })}
          type="primary"
        >
          新建角色
        </Button>
      </div>
      {personas.length === 0 ? (
        <Empty
          description={personaQuery ? "没有匹配的角色" : "还没有角色"}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          {!personaQuery ? (
            <Button
              icon={<PlusOutlined />}
              onClick={() => setPersonaDrawer({ mode: "create" })}
              type="primary"
            >
              新建第一个角色
            </Button>
          ) : null}
        </Empty>
      ) : (
        <>
          <div className={styles.entityGrid}>
            {pagePersonas.map((persona) => (
            <PersonaCard
              key={persona.id}
              busy={busy}
              onDelete={() => onDeletePersona(persona.id)}
              onEdit={() => setPersonaDrawer({ mode: "edit", persona })}
              persona={persona}
              scenarioNames={catalog.scenarios
                .filter((scenario) =>
                  scenario.allowedPersonaIds.includes(persona.id),
                )
                .map((scenario) => scenario.name)}
            />
            ))}
          </div>
          {personas.length > PAGE_SIZE ? (
            <Pagination
              className={styles.pagination}
              current={visiblePersonaPage}
              onChange={setPersonaPage}
              pageSize={PAGE_SIZE}
              showSizeChanger={false}
              total={personas.length}
            />
          ) : null}
        </>
      )}
    </section>
  );

  const scenarioPanel = (
    <section aria-label="场景管理" className={styles.panel}>
      <div className={styles.toolbar}>
        <Input
          allowClear
          aria-label="搜索场景"
          onChange={(event) => {
            setScenarioQuery(event.target.value);
            setScenarioPage(1);
          }}
          placeholder="按名称、描述、目标或重点技能搜索"
          prefix={<SearchOutlined />}
          value={scenarioQuery}
        />
        <Tooltip
          title={catalog.personas.length === 0 ? "请先创建一个角色" : undefined}
        >
          <Button
            disabled={busy || catalog.personas.length === 0}
            icon={<PlusOutlined />}
            onClick={() => setScenarioDrawer({ mode: "create" })}
            type="primary"
          >
            新建场景
          </Button>
        </Tooltip>
      </div>
      {scenarios.length === 0 ? (
        <Empty
          description={scenarioQuery ? "没有匹配的场景" : "还没有场景"}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          {!scenarioQuery && catalog.personas.length > 0 ? (
            <Button
              icon={<PlusOutlined />}
              onClick={() => setScenarioDrawer({ mode: "create" })}
              type="primary"
            >
              新建第一个场景
            </Button>
          ) : null}
        </Empty>
      ) : (
        <>
          <div className={styles.entityGrid}>
            {pageScenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              busy={busy}
              onDelete={() => onDeleteScenario(scenario.id)}
              onEdit={() => setScenarioDrawer({ mode: "edit", scenario })}
              personaNames={scenario.allowedPersonaIds
                .map((id) => catalog.personas.find((persona) => persona.id === id)?.name)
                .filter((name): name is string => Boolean(name))}
              scenario={scenario}
            />
            ))}
          </div>
          {scenarios.length > PAGE_SIZE ? (
            <Pagination
              className={styles.pagination}
              current={visibleScenarioPage}
              onChange={setScenarioPage}
              pageSize={PAGE_SIZE}
              showSizeChanger={false}
              total={scenarios.length}
            />
          ) : null}
        </>
      )}
    </section>
  );

  return (
    <main className={styles.console}>
      <header className={styles.header}>
        <div>
          <Typography.Title className={styles.title} level={2}>
            角色对练控制台
          </Typography.Title>
          <Typography.Text type="secondary">
            配置客户角色和销售训练场景，并在保存前检查模型 Instructions。
          </Typography.Text>
        </div>
        <Space className={styles.headerActions} wrap>
          {themeButton}
          <Button disabled={busy} onClick={onExit}>
            返回对练
          </Button>
        </Space>
      </header>

      {error ? (
        <Alert
          className={styles.globalAlert}
          title="控制台操作失败"
          description={error}
          showIcon
          type="error"
        />
      ) : null}

      <Card className={styles.contentCard}>
        <Tabs
          items={[
            {
              key: "personas",
              label: (
                <Space size="small">
                  角色
                  <Badge count={catalog.personas.length} showZero />
                </Space>
              ),
              children: personaPanel,
            },
            {
              key: "scenarios",
              label: (
                <Space size="small">
                  场景
                  <Badge count={catalog.scenarios.length} showZero />
                </Space>
              ),
              children: scenarioPanel,
            },
          ]}
        />
      </Card>

      {personaDrawer ? (
        <PersonaEditorDrawer
          busy={busy}
          key={
            personaDrawer.mode === "edit"
              ? `edit-${personaDrawer.persona.id}`
              : "create"
          }
          onCancel={() => setPersonaDrawer(undefined)}
          onSubmit={async (input) => {
            if (personaDrawer.mode === "edit") {
              await onUpdatePersona(personaDrawer.persona.id, input);
            } else {
              await onCreatePersona(input);
            }
            setPersonaDrawer(undefined);
          }}
          persona={
            personaDrawer.mode === "edit" ? personaDrawer.persona : undefined
          }
          personaPresets={catalog.personaPresets}
          scenarios={catalog.scenarios}
        />
      ) : null}

      {scenarioDrawer ? (
        <ScenarioEditorDrawer
          busy={busy}
          key={
            scenarioDrawer.mode === "edit"
              ? `edit-${scenarioDrawer.scenario.id}`
              : "create"
          }
          onCancel={() => setScenarioDrawer(undefined)}
          onSubmit={async (input) => {
            if (scenarioDrawer.mode === "edit") {
              await onUpdateScenario(scenarioDrawer.scenario.id, input);
            } else {
              await onCreateScenario(input);
            }
            setScenarioDrawer(undefined);
          }}
          personas={catalog.personas}
          scenario={
            scenarioDrawer.mode === "edit" ? scenarioDrawer.scenario : undefined
          }
        />
      ) : null}
    </main>
  );
}
