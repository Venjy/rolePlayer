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
  QwenVoiceDefinition,
} from "../../shared/role-play-catalog";
import { compilePersonaInstructions } from "../../shared/role-play-instructions";
import { resolvePersonaPresetReferences } from "../../shared/role-play-preset-resolution";
import {
  getGenderOptions,
  getVoiceOptions,
} from "./admin-options";
import { useI18n, type AppLocale } from "../i18n";
import { translate } from "../i18n/locale";
import { localizePersonaInput, localizePersona } from "../catalog/catalog-localization";
import { buildPersonaPresetOptions } from "./persona-preset-options";
import {
  normalizePersonaFormValues,
  getPersonaFormInitialValues,
  type PersonaFormValues,
} from "./persona-form-values";
import { PromptPreview } from "./PromptPreview";
import styles from "./AdminConsole.module.css";

interface PersonaEditorDrawerProps {
  persona?: Persona;
  personaPresets: PersonaPreset[];
  qwenVoices: QwenVoiceDefinition[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: PersonaInput) => Promise<void>;
}

function listRule(
  locale: AppLocale,
  label: string,
  maximum: number,
) {
  return {
    validator: async (_rule: unknown, value: unknown) => {
      const items = Array.isArray(value) ? value : [];
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
    },
  };
}

function buildPreviewPersona(
  locale: AppLocale,
  values?: Partial<PersonaFormValues>,
  persona?: Persona,
  presets: readonly PersonaPreset[] = [],
) {
  const initial = getPersonaFormInitialValues(persona, locale, presets);
  return resolvePersonaPresetReferences(
    normalizePersonaFormValues({ ...initial, ...values }, locale, persona),
    presets,
  );
}

export function PersonaEditorDrawer({
  persona,
  personaPresets,
  qwenVoices,
  busy,
  onCancel,
  onSubmit,
}: PersonaEditorDrawerProps) {
  const { locale, t } = useI18n();
  const [form] = Form.useForm<PersonaFormValues>();
  const [submitError, setSubmitError] = useState<string>();
  const draft = Form.useWatch([], form);

  const presetOptions = useMemo(
    () => buildPersonaPresetOptions(personaPresets, locale),
    [locale, personaPresets],
  );
  const voiceOptions = useMemo(
    () => getVoiceOptions(qwenVoices, locale),
    [locale, qwenVoices],
  );
  const requiredPresetLabels: Partial<
    Record<PersonaPresetCategory, string>
  > = {
    occupation: t({ en: "occupation", zh: "职业" }),
    personality_trait: t({ en: "personality traits", zh: "性格特征" }),
    communication_style: t({ en: "communication style", zh: "沟通风格" }),
  };
  const missingRequiredPresets = Object.entries(requiredPresetLabels)
        .filter(
          ([category]) =>
            presetOptions[category as PersonaPresetCategory].length === 0,
        )
        .map(([, label]) => label);
  if (voiceOptions.length === 0) {
    missingRequiredPresets.push(t({ en: "voice", zh: "音色" }));
  }
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

  const initialValues = getPersonaFormInitialValues(persona, locale, personaPresets);

  const preview = useMemo(() => {
    const previewPersona = localizePersonaInput(
      buildPreviewPersona(locale, draft, persona, personaPresets),
      locale,
    );
    return {
      prompt: compilePersonaInstructions(previewPersona, locale),
      lengthIssue: null,
    };
  }, [draft, locale, persona, personaPresets]);

  const handleFinish = async (values: PersonaFormValues) => {
    setSubmitError(undefined);
    if (presetInitializationMessage) {
      setSubmitError(presetInitializationMessage);
      return;
    }
    const normalizedInput = normalizePersonaFormValues(
      values,
      locale,
      persona,
    );

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
        <div className={styles.personaBasicsGrid}>
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
              en: "Choose the persona's occupation",
              zh: "选择角色的职业",
            })}
            label={t({ en: "Occupation", zh: "职业" })}
            name="occupationPresetId"
            rules={[{ required: true }]}
          >
            <Select
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
        </div>
        <div className={styles.formGrid}>
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
            name="personalityTraitPresetIds"
            rules={[
              {
                required: true,
                type: "array",
                min: 1,
                message: t({
                  en: "Select at least one personality trait.",
                  zh: "请至少选择一项性格特征。",
                }),
              },
              listRule(
                locale,
                t({ en: "personality traits", zh: "性格特征" }),
                12,
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
            name="communicationStylePresetId"
            rules={[{ required: true }]}
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
            name="motivationPresetIds"
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
            name="concernPresetIds"
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
            <Select options={voiceOptions} />
          </Form.Item>
        </div>

        <Divider titlePlacement="start">
          {t({ en: "Instructions check", zh: "提示词检查" })}
        </Divider>
        <PromptPreview
          note={t({
            en: "This preview contains persona Instructions only. The server combines it with the selected scenario when a conversation starts.",
            zh: "此处只预览角色 Instructions；开始对话时，服务端才会与所选场景拼接。",
          })}
          lengthIssue={preview.lengthIssue}
          prompt={preview.prompt}
        />
      </Form>
    </Drawer>
  );
}
