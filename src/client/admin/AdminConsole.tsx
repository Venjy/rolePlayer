import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Space,
  Select,
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
import {
  localizePersona,
  localizeScenario,
} from "../catalog/catalog-localization";
import { useI18n } from "../i18n";
import { includesSearchText } from "./admin-options";
import { PersonaEditorDrawer } from "./PersonaEditorDrawer";
import { ScenarioEditorDrawer } from "./ScenarioEditorDrawer";
import styles from "./AdminConsole.module.css";

export interface AdminConsoleProps {
  catalog: RolePlayCatalog;
  busy: boolean;
  error?: string;
  onExit: () => void;
  onCreatePersona: (input: PersonaInput) => Promise<void>;
  onUpdatePersona: (id: number, input: PersonaInput) => Promise<void>;
  onDeletePersona: (id: number) => Promise<void>;
  onCreateScenario: (input: ScenarioInput) => Promise<void>;
  onUpdateScenario: (id: number, input: ScenarioInput) => Promise<void>;
  onDeleteScenario: (id: number) => Promise<void>;
}

type PersonaDrawerState = { mode: "create" } | { mode: "edit"; persona: Persona };
type ScenarioDrawerState =
  | { mode: "create" }
  | { mode: "edit"; scenario: Scenario };

const PAGE_SIZE = 9;

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
  const { locale, t } = useI18n();
  const genderLabel = {
    female: t({ en: "Female", zh: "女" }),
    male: t({ en: "Male", zh: "男" }),
    non_binary: t({ en: "Non-binary", zh: "非二元" }),
    unspecified: t({ en: "Not specified", zh: "未指定" }),
  } satisfies Record<Persona["gender"], string>;
  const associationSeparator = locale === "zh" ? "、" : ", ";
  const ageLabel = persona.age
    ? t(
        { en: "{age} years old", zh: "{age} 岁" },
        { age: persona.age },
      )
    : t({ en: "Age not provided", zh: "年龄未填写" });
  const metadata = [
    genderLabel[persona.gender],
    ageLabel,
    persona.occupation,
  ].join(" · ");

  return (
    <Card
      className={`${styles.entityCard} ${styles.personaCard}`}
      size="small"
    >
      <div className={styles.cardHeader}>
        <div className={styles.personaIdentity}>
          <span
            aria-hidden
            className={styles.entityIcon}
            data-gender={persona.gender}
          >
            <UserOutlined />
          </span>
          <div className={styles.personaHeading}>
            <Typography.Title className={styles.cardTitle} level={4}>
              {persona.name}
            </Typography.Title>
            <Typography.Text className={styles.personaMetadata} type="secondary">
              {metadata}
            </Typography.Text>
          </div>
        </div>
      </div>

      <div className={styles.personaContent}>
        <Typography.Text className={styles.cardSectionLabel} type="secondary">
          {t({ en: "Background", zh: "背景" })}
        </Typography.Text>
        <Typography.Paragraph
          className={styles.personaBackground}
          ellipsis={{ rows: 4 }}
          type={persona.background ? undefined : "secondary"}
        >
          {persona.background ||
            t({ en: "No background provided", zh: "尚未填写角色背景" })}
        </Typography.Paragraph>

        <Typography.Text className={styles.cardSectionLabel} type="secondary">
          {t({ en: "Personality traits", zh: "性格特征" })}
        </Typography.Text>
        <Space className={styles.tagCloud} size={[4, 6]} wrap>
          {persona.personalityTraits.slice(0, 4).map((trait) => (
            <Tag key={trait}>{trait}</Tag>
          ))}
          {persona.personalityTraits.length > 4 ? (
            <Tag>+{persona.personalityTraits.length - 4}</Tag>
          ) : null}
        </Space>
      </div>

      <div className={styles.cardFooter}>
        <Typography.Text type="secondary">
          {t(
            scenarioNames.length === 1
              ? {
                  en: "Available in 1 scenario",
                  zh: "可用于 1 个场景",
                }
              : {
                  en: "Available in {count} scenarios",
                  zh: "可用于 {count} 个场景",
                },
            { count: scenarioNames.length },
          )}
        </Typography.Text>
        <Space size="small">
          <Button
            aria-label={t(
              { en: "Edit persona {name}", zh: "编辑角色 {name}" },
              { name: persona.name },
            )}
            disabled={busy}
            icon={<EditOutlined />}
            onClick={onEdit}
            size="small"
          >
            {t({ en: "Edit", zh: "编辑" })}
          </Button>
          {scenarioNames.length > 0 ? (
            <Tooltip
              title={t(
                {
                  en: "Remove this persona from these scenarios first: {scenarios}",
                  zh: "请先在这些场景中移除该角色：{scenarios}",
                },
                { scenarios: scenarioNames.join(associationSeparator) },
              )}
            >
              <span>
                <Button
                  aria-label={t(
                    {
                      en: "Cannot delete persona {name}; it is still linked to scenarios",
                      zh: "无法删除角色 {name}，仍有关联场景",
                    },
                    { name: persona.name },
                  )}
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
              cancelText={t({ en: "Cancel", zh: "取消" })}
              description={t({
                en: "This cannot be undone.",
                zh: "删除后无法恢复。",
              })}
              okButtonProps={{ danger: true }}
              okText={t({ en: "Delete", zh: "删除" })}
              onConfirm={onDelete}
              title={t(
                {
                  en: "Delete persona “{name}”?",
                  zh: "删除角色“{name}”？",
                },
                { name: persona.name },
              )}
            >
              <Button
                aria-label={t(
                  { en: "Delete persona {name}", zh: "删除角色 {name}" },
                  { name: persona.name },
                )}
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
  onEditCompatibility,
  onEdit,
  onDelete,
}: {
  scenario: Scenario;
  busy: boolean;
  personaNames: string[];
  onEditCompatibility: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const nameSeparator = locale === "zh" ? "、" : ", ";

  return (
    <Card className={styles.entityCard} size="small">
      <div className={styles.cardHeader}>
        <div>
          <Typography.Title className={styles.cardTitle} level={4}>
            {scenario.name}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(
              { en: "{count} success criteria", zh: "{count} 项成功标准" },
              { count: scenario.successCriteria.length },
            )}
          </Typography.Text>
        </div>
        <Badge
          count={t(
            scenario.allowedPersonaIds.length === 1
              ? { en: "1 persona", zh: "1 个角色" }
              : { en: "{count} personas", zh: "{count} 个角色" },
            { count: scenario.allowedPersonaIds.length },
          )}
          showZero
          color="blue"
        />
      </div>

      <Typography.Paragraph
        className={styles.cardDescription}
        ellipsis={{ rows: 2 }}
      >
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
          title={
            personaNames.length > 0
              ? personaNames.join(nameSeparator)
              : t({ en: "No available personas", zh: "没有可用角色" })
          }
        >
          <Typography.Text className={styles.personaSummary} type="secondary">
            {personaNames.length > 0
              ? t(
                  { en: "Personas: {names}{more}", zh: "角色：{names}{more}" },
                  {
                    names: personaNames.slice(0, 2).join(nameSeparator),
                    more: personaNames.length > 2 ? "…" : "",
                  },
                )
              : t({ en: "No available personas", zh: "没有可用角色" })}
          </Typography.Text>
        </Tooltip>
        <Space size="small">
          <Button
            disabled={busy}
            icon={<LinkOutlined />}
            onClick={onEditCompatibility}
            size="small"
          >
            {t({ en: "Compatibility", zh: "兼容角色" })}
          </Button>
          <Button
            aria-label={t(
              { en: "Edit scenario {name}", zh: "编辑场景 {name}" },
              { name: scenario.name },
            )}
            disabled={busy}
            icon={<EditOutlined />}
            onClick={onEdit}
            size="small"
          >
            {t({ en: "Edit", zh: "编辑" })}
          </Button>
          <Popconfirm
            cancelText={t({ en: "Cancel", zh: "取消" })}
            description={t({
              en: "This cannot be undone.",
              zh: "删除后无法恢复。",
            })}
            okButtonProps={{ danger: true }}
            okText={t({ en: "Delete", zh: "删除" })}
            onConfirm={onDelete}
            title={t(
              {
                en: "Delete scenario “{name}”?",
                zh: "删除场景“{name}”？",
              },
              { name: scenario.name },
            )}
          >
            <Button
              aria-label={t(
                { en: "Delete scenario {name}", zh: "删除场景 {name}" },
                { name: scenario.name },
              )}
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
  onExit,
  onCreatePersona,
  onUpdatePersona,
  onDeletePersona,
  onCreateScenario,
  onUpdateScenario,
  onDeleteScenario,
}: AdminConsoleProps) {
  const { locale, t } = useI18n();
  const [personaQuery, setPersonaQuery] = useState("");
  const [scenarioQuery, setScenarioQuery] = useState("");
  const [personaPage, setPersonaPage] = useState(1);
  const [scenarioPage, setScenarioPage] = useState(1);
  const [personaDrawer, setPersonaDrawer] = useState<PersonaDrawerState>();
  const [scenarioDrawer, setScenarioDrawer] = useState<ScenarioDrawerState>();
  const [compatibilityScenario, setCompatibilityScenario] = useState<Scenario>();
  const [compatibilityPersonaIds, setCompatibilityPersonaIds] = useState<number[]>([]);

  const personas = useMemo(
    () =>
      catalog.personas
        .map((persona) => ({
          canonical: persona,
          display: localizePersona(persona, locale),
        }))
        .filter(({ canonical, display }) =>
          includesSearchText(
            personaQuery,
            display.name,
            display.occupation,
            display.personalityTraits,
            canonical.name,
            canonical.nameZhCn,
            canonical.occupation,
            canonical.occupationZhCn,
            canonical.personalityTraits,
            canonical.personalityTraitsZhCn,
          ),
        ),
    [catalog.personas, locale, personaQuery],
  );
  const scenarios = useMemo(
    () =>
      catalog.scenarios
        .map((scenario) => ({
          canonical: scenario,
          display: localizeScenario(scenario, locale),
        }))
        .filter(({ canonical, display }) =>
          includesSearchText(
            scenarioQuery,
            display.name,
            display.description,
            display.goals,
            display.suggestedSkillFocus,
            canonical.name,
            canonical.nameZhCn,
            canonical.description,
            canonical.descriptionZhCn,
            canonical.goals,
            canonical.goalsZhCn,
            canonical.suggestedSkillFocus,
            canonical.suggestedSkillFocusZhCn,
          ),
        ),
    [catalog.scenarios, locale, scenarioQuery],
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
    <section
      aria-label={t({ en: "Persona management", zh: "角色管理" })}
      className={styles.panel}
    >
      <div className={styles.toolbar}>
        <Input
          allowClear
          aria-label={t({ en: "Search personas", zh: "搜索角色" })}
          onChange={(event) => {
            setPersonaQuery(event.target.value);
            setPersonaPage(1);
          }}
          placeholder={t({
            en: "Search by name, occupation, or personality",
            zh: "按名字、职业或性格搜索",
          })}
          prefix={<SearchOutlined />}
          value={personaQuery}
        />
        <Button
          disabled={busy}
          icon={<PlusOutlined />}
          onClick={() => setPersonaDrawer({ mode: "create" })}
          type="primary"
        >
          {t({ en: "New persona", zh: "新建角色" })}
        </Button>
      </div>
      {personas.length === 0 ? (
        <Empty
          description={
            personaQuery
              ? t({ en: "No matching personas", zh: "没有匹配的角色" })
              : t({ en: "No personas yet", zh: "还没有角色" })
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          {!personaQuery ? (
            <Button
              icon={<PlusOutlined />}
              onClick={() => setPersonaDrawer({ mode: "create" })}
              type="primary"
            >
              {t({ en: "Create the first persona", zh: "新建第一个角色" })}
            </Button>
          ) : null}
        </Empty>
      ) : (
        <>
          <div className={styles.entityGrid}>
            {pagePersonas.map(({ canonical, display }) => (
              <PersonaCard
                key={canonical.id}
                busy={busy}
                onDelete={() => onDeletePersona(canonical.id)}
                onEdit={() =>
                  setPersonaDrawer({ mode: "edit", persona: canonical })
                }
                persona={display}
                scenarioNames={catalog.scenarios
                  .filter((scenario) =>
                    scenario.allowedPersonaIds.includes(canonical.id),
                  )
                  .map((scenario) => localizeScenario(scenario, locale).name)}
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
    <section
      aria-label={t({ en: "Scenario management", zh: "场景管理" })}
      className={styles.panel}
    >
      <div className={styles.toolbar}>
        <Input
          allowClear
          aria-label={t({ en: "Search scenarios", zh: "搜索场景" })}
          onChange={(event) => {
            setScenarioQuery(event.target.value);
            setScenarioPage(1);
          }}
          placeholder={t({
            en: "Search by name, description, goal, or focus skill",
            zh: "按名称、描述、目标或重点技能搜索",
          })}
          prefix={<SearchOutlined />}
          value={scenarioQuery}
        />
        <Button
          disabled={busy}
          icon={<PlusOutlined />}
          onClick={() => setScenarioDrawer({ mode: "create" })}
          type="primary"
        >
          {t({ en: "New scenario", zh: "新建场景" })}
        </Button>
      </div>
      {scenarios.length === 0 ? (
        <Empty
          description={
            scenarioQuery
              ? t({ en: "No matching scenarios", zh: "没有匹配的场景" })
              : t({ en: "No scenarios yet", zh: "还没有场景" })
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          {!scenarioQuery ? (
            <Button
              icon={<PlusOutlined />}
              onClick={() => setScenarioDrawer({ mode: "create" })}
              type="primary"
            >
              {t({ en: "Create the first scenario", zh: "新建第一个场景" })}
            </Button>
          ) : null}
        </Empty>
      ) : (
        <>
          <div className={styles.entityGrid}>
            {pageScenarios.map(({ canonical, display }) => (
              <ScenarioCard
                key={canonical.id}
                busy={busy}
                onDelete={() => onDeleteScenario(canonical.id)}
                onEdit={() =>
                  setScenarioDrawer({ mode: "edit", scenario: canonical })
                }
                onEditCompatibility={() => {
                  setCompatibilityPersonaIds(canonical.allowedPersonaIds);
                  setCompatibilityScenario(canonical);
                }}
                personaNames={canonical.allowedPersonaIds
                  .map((id) => {
                    const persona = catalog.personas.find(
                      (candidate) => candidate.id === id,
                    );
                    return persona
                      ? localizePersona(persona, locale).name
                      : undefined;
                  })
                  .filter((name): name is string => Boolean(name))}
                scenario={display}
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
        <div className={styles.headerTitleGroup}>
          <Button
            aria-label={t({ en: "Back to practice", zh: "返回对练" })}
            disabled={busy}
            icon={<ArrowLeftOutlined />}
            onClick={onExit}
          />
          <div>
          <Typography.Title className={styles.title} level={2}>
            {t({ en: "Role-play admin console", zh: "角色对练控制台" })}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t({
              en: "Configure customer personas and sales training scenarios, and review model Instructions before saving.",
              zh: "配置客户角色和销售训练场景，并在保存前检查模型 Instructions。",
            })}
          </Typography.Text>
          </div>
        </div>
      </header>

      {error ? (
        <Alert
          className={styles.globalAlert}
          title={t({
            en: "Admin console operation failed",
            zh: "控制台操作失败",
          })}
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
                  {t({ en: "Personas", zh: "角色" })}
                  <Badge count={catalog.personas.length} showZero />
                </Space>
              ),
              children: personaPanel,
            },
            {
              key: "scenarios",
              label: (
                <Space size="small">
                  {t({ en: "Scenarios", zh: "场景" })}
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
          key={`${
            personaDrawer.mode === "edit"
              ? `edit-${personaDrawer.persona.id}`
              : "create"
          }-${locale}`}
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
          qwenVoices={catalog.qwenVoices}
        />
      ) : null}

      {scenarioDrawer ? (
        <ScenarioEditorDrawer
          busy={busy}
          key={`${
            scenarioDrawer.mode === "edit"
              ? `edit-${scenarioDrawer.scenario.id}`
              : "create"
          }-${locale}`}
          onCancel={() => setScenarioDrawer(undefined)}
          onSubmit={async (input) => {
            if (scenarioDrawer.mode === "edit") {
              await onUpdateScenario(scenarioDrawer.scenario.id, input);
            } else {
              await onCreateScenario(input);
            }
            setScenarioDrawer(undefined);
          }}
          defaultAllowedPersonaIds={catalog.personas.map(({ id }) => id)}
          scenarioPresets={catalog.scenarioPresets}
          scenario={
            scenarioDrawer.mode === "edit" ? scenarioDrawer.scenario : undefined
          }
        />
      ) : null}

      <Modal
        cancelText={t({ en: "Cancel", zh: "取消" })}
        confirmLoading={busy}
        okText={t({ en: "Save compatibility", zh: "保存兼容关系" })}
        onCancel={() => setCompatibilityScenario(undefined)}
        onOk={async () => {
          if (!compatibilityScenario) return;
          await onUpdateScenario(compatibilityScenario.id, {
            ...compatibilityScenario,
            allowedPersonaIds: compatibilityPersonaIds,
          });
          setCompatibilityScenario(undefined);
        }}
        open={Boolean(compatibilityScenario)}
        title={t({ en: "Compatible personas", zh: "兼容角色" })}
      >
        <Typography.Paragraph type="secondary">
          {t({
            en: "Compatibility is managed independently from scenario content and is not included in the scenario Instructions preview.",
            zh: "兼容关系独立于场景内容管理，也不会出现在场景 Instructions 预览中。",
          })}
        </Typography.Paragraph>
        <Select
          className={styles.fullWidth}
          maxCount={100}
          mode="multiple"
          onChange={setCompatibilityPersonaIds}
          optionFilterProp="label"
          options={catalog.personas.map((persona) => {
            const display = localizePersona(persona, locale);
            return {
              value: persona.id,
              label: `${display.name} · ${display.occupation}`,
            };
          })}
          placeholder={t({ en: "Select compatible personas", zh: "选择兼容角色" })}
          value={compatibilityPersonaIds}
        />
      </Modal>
    </main>
  );
}
