import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
} from "antd";
import type {
  Persona,
  PersonaInput,
  PersonaPreset,
  PersonaPresetCategory,
  Scenario,
} from "../../shared/role-play-catalog";
import {
  compileRolePlayInstructions,
  findRolePlayInstructionsLengthIssue,
} from "../../shared/role-play-instructions";
import {
  cleanStringList,
  getFallbackPersona,
  getFallbackScenario,
  getGenderOptions,
  getVoiceOptions,
} from "./admin-options";
import { useI18n, type AppLocale } from "../i18n";
import { translate } from "../i18n/locale";
import {
  localizePersonaInput,
  localizePersona,
  localizeScenario,
} from "../catalog/catalog-localization";
import { buildPersonaPresetOptions } from "./persona-preset-options";
import {
  normalizePersonaFormValues,
  type PersonaFormValues,
} from "./persona-form-values";
import { PromptPreview } from "./PromptPreview";
import styles from "./AdminConsole.module.css";

interface PersonaEditorDrawerProps {
  persona?: Persona;
  personaPresets: PersonaPreset[];
  scenarios: Scenario[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: PersonaInput) => Promise<void>;
}

function listRule(
  locale: AppLocale,
  label: string,
  maximum: number,
  required = false,
) {
  return {
    validator: async (_rule: unknown, value: unknown) => {
      const items = cleanStringList(value);
      if (required && items.length === 0) {
        throw new Error(
          translate(
            locale,
            {
              en: "Select at least one {label}.",
              zh: "请至少选择一项{label}。",
            },
            { label },
          ),
        );
      }
      if (items.length > maximum) {
        throw new Error(
          translate(
            locale,
            {
              en: "{label} allows up to {maximum} items.",
              zh: "{label}最多可选 {maximum} 项。",
            },
            { label, maximum },
          ),
        );
      }
      if (items.some((item) => item.length > 160)) {
        throw new Error(
          translate(
            locale,
            {
              en: "Each {label} item must be no more than 160 characters.",
              zh: "{label}单项不能超过 160 个字符。",
            },
            { label },
          ),
        );
      }
    },
  };
}

function buildPreviewPersona(
  locale: AppLocale,
  values?: Partial<PersonaFormValues>,
): PersonaInput {
  const fallbackPersona = getFallbackPersona(locale);
  return {
    name: values?.name?.trim() || fallbackPersona.name,
    gender: values?.gender ?? fallbackPersona.gender,
    age: typeof values?.age === "number" ? values.age : null,
    occupation: values?.occupation?.trim() ?? "",
    identity: values?.identity?.trim() || fallbackPersona.identity,
    background: values?.background?.trim() ?? "",
    personalityTraits:
      cleanStringList(values?.personalityTraits).length > 0
        ? cleanStringList(values?.personalityTraits)
        : fallbackPersona.personalityTraits,
    communicationStyle:
      values?.communicationStyle?.trim() ||
      fallbackPersona.communicationStyle,
    behaviorNotes: values?.behaviorNotes?.trim() ?? "",
    motivations: cleanStringList(values?.motivations),
    concerns: cleanStringList(values?.concerns),
    voice: values?.voice ?? fallbackPersona.voice,
  };
}

export function PersonaEditorDrawer({
  persona,
  personaPresets,
  scenarios,
  busy,
  onCancel,
  onSubmit,
}: PersonaEditorDrawerProps) {
  const { locale, t } = useI18n();
  const [form] = Form.useForm<PersonaFormValues>();
  const [submitError, setSubmitError] = useState<string>();
  const draft = Form.useWatch([], form);

  const presetOptions = useMemo(
    () => buildPersonaPresetOptions(personaPresets, locale, persona),
    [locale, persona, personaPresets],
  );
  const requiredPresetLabels: Partial<
    Record<PersonaPresetCategory, string>
  > = {
    identity: t({ en: "identity", zh: "身份" }),
    personality_trait: t({ en: "personality traits", zh: "性格特征" }),
    communication_style: t({ en: "communication style", zh: "沟通风格" }),
  };
  const missingRequiredPresets = persona
    ? []
    : Object.entries(requiredPresetLabels)
        .filter(
          ([category]) =>
            presetOptions[category as PersonaPresetCategory].length === 0,
        )
        .map(([, label]) => label);
  const presetInitializationMessage =
    missingRequiredPresets.length > 0
      ? t(
          {
            en: "Required presets are missing: {presets}. Run the deployment initializer before creating a persona.",
            zh: "缺少必要预设：{presets}。请先运行部署初始化脚本，再新建角色。",
          },
          { presets: missingRequiredPresets.join(locale === "zh" ? "、" : ", ") },
        )
      : undefined;

  const defaultScenarioId =
    scenarios.find((scenario) =>
      persona ? scenario.allowedPersonaIds.includes(persona.id) : false,
    )?.id ?? scenarios[0]?.id;

  const initialValues: PersonaFormValues = {
    name: persona?.name ?? "",
    gender: persona?.gender ?? "unspecified",
    age: persona?.age ?? null,
    occupation: persona?.occupation ?? "",
    identity: persona?.identity ?? "",
    background: persona?.background ?? "",
    personalityTraits: persona?.personalityTraits ?? [],
    communicationStyle: persona?.communicationStyle ?? "",
    behaviorNotes: persona?.behaviorNotes ?? "",
    motivations: persona?.motivations ?? [],
    concerns: persona?.concerns ?? [],
    voice: persona?.voice ?? "longanqian",
    previewScenarioId: defaultScenarioId,
  };

  const preview = useMemo(() => {
    const selectedScenario = scenarios.find(
      (scenario) => scenario.id === draft?.previewScenarioId,
    );
    const previewPersona = localizePersonaInput(
      buildPreviewPersona(locale, draft),
      locale,
      personaPresets,
    );
    const previewScenario = selectedScenario
      ? localizeScenario(selectedScenario, locale)
      : getFallbackScenario(locale);
    const lengthIssue = findRolePlayInstructionsLengthIssue({
      persona: previewPersona,
      scenario: previewScenario,
    });
    return {
      prompt: compileRolePlayInstructions({
        persona: previewPersona,
        scenario: previewScenario,
        difficulty: lengthIssue?.difficulty ?? "medium",
      }),
      lengthIssue,
    };
  }, [draft, locale, personaPresets, scenarios]);

  const handleFinish = async (values: PersonaFormValues) => {
    setSubmitError(undefined);
    if (presetInitializationMessage) {
      setSubmitError(presetInitializationMessage);
      return;
    }
    const normalizedInput = normalizePersonaFormValues(values);

    if (persona) {
      for (const scenario of scenarios) {
        if (!scenario.allowedPersonaIds.includes(persona.id)) continue;
        const issue = findRolePlayInstructionsLengthIssue({
          persona: normalizedInput,
          scenario,
        });
        if (issue) {
          setSubmitError(
            t(
              {
                en: "The Instructions generated with scenario “{name}” are too long ({actual}/{maximum} characters). Shorten the persona configuration.",
                zh: "与场景“{name}”组合后的 Instructions 过长（{actual}/{maximum} 字符），请精简角色配置。",
              },
              {
                name: localizeScenario(scenario, locale).name,
                actual: issue.actualLength,
                maximum: issue.maximumLength,
              },
            ),
          );
          return;
        }
      }
    }

    try {
      await onSubmit(normalizedInput);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t({
              en: "Could not save the persona. Try again later.",
              zh: "保存角色失败，请稍后重试。",
            }),
      );
    }
  };

  return (
    <Drawer
      className={styles.editorDrawer}
      extra={
        <Space>
          <Button disabled={busy} onClick={onCancel}>
            {t({ en: "Cancel", zh: "取消" })}
          </Button>
          <Button
            disabled={Boolean(presetInitializationMessage)}
            loading={busy}
            onClick={() => form.submit()}
            type="primary"
          >
            {t({ en: "Save persona", zh: "保存角色" })}
          </Button>
        </Space>
      }
      keyboard={!busy}
      maskClosable={!busy}
      onClose={busy ? undefined : onCancel}
      open
      size="large"
      title={
        persona
          ? t(
              { en: "Edit persona: {name}", zh: "编辑角色：{name}" },
              { name: localizePersona(persona, locale).name },
            )
          : t({ en: "New persona", zh: "新建角色" })
      }
    >
      {submitError ? (
        <Alert
          className={styles.formAlert}
          closable
          title={submitError}
          onClose={() => setSubmitError(undefined)}
          showIcon
          type="error"
        />
      ) : null}
      {presetInitializationMessage ? (
        <Alert
          className={styles.formAlert}
          description={t({
            en: "Required fields in this form can only use SQLite presets. Reopen the form after initialization to create a persona.",
            zh: "该表单的必填项只能从 SQLite 预设中选择，初始化完成后重新打开即可创建。",
          })}
          showIcon
          title={presetInitializationMessage}
          type="warning"
        />
      ) : null}
      <Form<PersonaFormValues>
        form={form}
        initialValues={initialValues}
        layout="vertical"
        onFinish={handleFinish}
        requiredMark="optional"
        validateMessages={{
          required: t({
            en: "Please enter or select ${label}.",
            zh: "请填写或选择${label}。",
          }),
          whitespace: t({
            en: "${label} cannot be blank.",
            zh: "${label}不能只包含空格。",
          }),
          string: {
            max: t({
              en: "${label} must be no more than ${max} characters.",
              zh: "${label}不能超过 ${max} 个字符。",
            }),
          },
        }}
      >
        <div className={styles.formGrid}>
          <Form.Item
            label={t({ en: "Name", zh: "名字" })}
            name="name"
            rules={[{ required: true, whitespace: true, max: 80 }]}
          >
            <Input
              maxLength={80}
              placeholder={t({ en: "For example: Taylor", zh: "例如：小张" })}
              showCount
            />
          </Form.Item>
          <Form.Item
            label={t({ en: "Gender", zh: "性别" })}
            name="gender"
            rules={[{ required: true }]}
          >
            <Select options={getGenderOptions(locale)} />
          </Form.Item>
          <Form.Item label={t({ en: "Age", zh: "年龄" })} name="age">
            <InputNumber
              className={styles.fullWidth}
              max={120}
              min={1}
              placeholder={t({ en: "Optional", zh: "可选" })}
              precision={0}
            />
          </Form.Item>
          <Form.Item
            extra={t({
              en: "Choose a preset or leave it blank",
              zh: "从预设中选择，可不填",
            })}
            label={t({ en: "Occupation", zh: "职业" })}
            name="occupation"
            rules={[{ max: 120 }]}
          >
            <Select
              allowClear
              className={styles.fullWidth}
              notFoundContent={t({
                en: "No occupation presets available",
                zh: "暂无可用职业预设",
              })}
              optionFilterProp="label"
              options={presetOptions.occupation}
              placeholder={t({ en: "Select an occupation", zh: "选择职业" })}
              showSearch
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            extra={t({
              en: "Choose the persona's role and point of view in the practice session",
              zh: "选择角色在对练中的身份和立场",
            })}
            label={t({ en: "Identity", zh: "身份" })}
            name="identity"
            rules={[{ required: true, max: 240 }]}
          >
            <Select
              className={styles.fullWidth}
              notFoundContent={t({
                en: "No identity presets available",
                zh: "暂无可用身份预设",
              })}
              optionFilterProp="label"
              options={presetOptions.identity}
              placeholder={t({ en: "Select an identity", zh: "选择身份" })}
              showSearch
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            label={t({ en: "Background", zh: "背景" })}
            name="background"
            rules={[{ max: 2_000 }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 6 }}
              maxLength={2_000}
              placeholder={t({
                en: "Experience, current situation, and information relevant to the sales scenario",
                zh: "经历、当前处境、与销售场景相关的信息",
              })}
              showCount
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            extra={t({
              en: "Choose 1–12 presets; search and multiple selection are supported",
              zh: "从预设中选择 1–12 项，可搜索和多选",
            })}
            label={t({ en: "Personality traits", zh: "性格特征" })}
            name="personalityTraits"
            rules={[
              listRule(
                locale,
                t({ en: "personality traits", zh: "性格特征" }),
                12,
                true,
              ),
            ]}
          >
            <Select
              allowClear
              className={styles.fullWidth}
              maxCount={12}
              maxTagCount="responsive"
              mode="multiple"
              notFoundContent={t({
                en: "No personality trait presets available",
                zh: "暂无可用性格预设",
              })}
              optionFilterProp="label"
              options={presetOptions.personality_trait}
              placeholder={t({
                en: "Select personality traits",
                zh: "选择性格特征",
              })}
              showSearch
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            extra={t({
              en: "Choose a preset for wording, expression habits, and interaction style",
              zh: "从预设中选择措辞、表达习惯和交流方式",
            })}
            label={t({ en: "Communication style", zh: "沟通风格" })}
            name="communicationStyle"
            rules={[{ required: true, max: 500 }]}
          >
            <Select
              className={styles.fullWidth}
              notFoundContent={t({
                en: "No communication style presets available",
                zh: "暂无可用沟通风格预设",
              })}
              optionFilterProp="label"
              options={presetOptions.communication_style}
              placeholder={t({
                en: "Select a communication style",
                zh: "选择沟通风格",
              })}
              showSearch
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            label={t({ en: "Behavior notes", zh: "行为说明" })}
            name="behaviorNotes"
            rules={[{ max: 2_000 }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 6 }}
              maxLength={2_000}
              placeholder={t({
                en: "Special behavior rules the persona should follow during practice",
                zh: "角色在对练中应遵循的特殊行为规则",
              })}
              showCount
            />
          </Form.Item>
          <Form.Item
            extra={t({
              en: "Choose up to 10 presets",
              zh: "从预设中选择，最多 10 项",
            })}
            label={t({ en: "Motivations", zh: "动机" })}
            name="motivations"
            rules={[
              listRule(
                locale,
                t({ en: "motivations", zh: "动机" }),
                10,
              ),
            ]}
          >
            <Select
              allowClear
              className={styles.fullWidth}
              maxCount={10}
              maxTagCount="responsive"
              mode="multiple"
              notFoundContent={t({
                en: "No motivation presets available",
                zh: "暂无可用动机预设",
              })}
              optionFilterProp="label"
              options={presetOptions.motivation}
              placeholder={t({
                en: "Select persona motivations",
                zh: "选择角色动机",
              })}
              showSearch
            />
          </Form.Item>
          <Form.Item
            extra={t({
              en: "Choose up to 10 presets",
              zh: "从预设中选择，最多 10 项",
            })}
            label={t({ en: "Concerns and objections", zh: "顾虑与异议" })}
            name="concerns"
            rules={[
              listRule(
                locale,
                t({ en: "concerns and objections", zh: "顾虑与异议" }),
                10,
              ),
            ]}
          >
            <Select
              allowClear
              className={styles.fullWidth}
              maxCount={10}
              maxTagCount="responsive"
              mode="multiple"
              notFoundContent={t({
                en: "No concern presets available",
                zh: "暂无可用顾虑预设",
              })}
              optionFilterProp="label"
              options={presetOptions.concern}
              placeholder={t({
                en: "Select concerns and objections",
                zh: "选择顾虑与异议",
              })}
              showSearch
            />
          </Form.Item>
          <Form.Item
            label={t({ en: "Voice", zh: "音色" })}
            name="voice"
            rules={[{ required: true }]}
          >
            <Select options={getVoiceOptions(locale)} />
          </Form.Item>
        </div>

        <Divider titlePlacement="start">
          {t({ en: "Instructions check", zh: "提示词检查" })}
        </Divider>
        {scenarios.length > 0 ? (
          <Form.Item
            label={t({ en: "Scenario used for preview", zh: "用于预览的场景" })}
            name="previewScenarioId"
          >
            <Select
              options={scenarios.map((scenario) => ({
                value: scenario.id,
                label: localizeScenario(scenario, locale).name,
              }))}
              placeholder={t({
                en: "Select a preview scenario",
                zh: "选择预览场景",
              })}
            />
          </Form.Item>
        ) : null}
        <PromptPreview
          note={
            scenarios.length === 0
              ? t({
                  en: "There are no scenarios yet, so the preview uses a general sales conversation.",
                  zh: "目前没有场景，预览暂时使用通用销售沟通场景。",
                })
              : undefined
          }
          lengthIssue={preview.lengthIssue}
          prompt={preview.prompt}
        />
      </Form>
    </Drawer>
  );
}
