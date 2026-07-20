import {
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Badge,
  Button,
  Card,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { Persona, Scenario } from "../../shared/role-play-catalog";
import { useI18n } from "../i18n";
import styles from "./AdminConsole.module.css";

interface PersonaCardProps {
  persona: Persona;
  busy: boolean;
  scenarioNames: string[];
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

export function PersonaCard({
  persona,
  busy,
  scenarioNames,
  onEdit,
  onDelete,
}: PersonaCardProps) {
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
              ? { en: "Available in 1 scenario", zh: "可用于 1 个场景" }
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
                { en: "Delete persona “{name}”?", zh: "删除角色“{name}”？" },
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

interface ScenarioCardProps {
  scenario: Scenario;
  busy: boolean;
  personaNames: string[];
  onEditCompatibility: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

export function ScenarioCard({
  scenario,
  busy,
  personaNames,
  onEditCompatibility,
  onEdit,
  onDelete,
}: ScenarioCardProps) {
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
              { en: "Delete scenario “{name}”?", zh: "删除场景“{name}”？" },
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
