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
  FALLBACK_PERSONA,
  FALLBACK_SCENARIO,
  GENDER_OPTIONS,
  VOICE_OPTIONS,
} from "./admin-options";
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

const REQUIRED_PRESET_LABELS: Partial<
  Record<PersonaPresetCategory, string>
> = {
  identity: "身份",
  personality_trait: "性格特征",
  communication_style: "沟通风格",
};

function listRule(label: string, maximum: number, required = false) {
  return {
    validator: async (_rule: unknown, value: unknown) => {
      const items = cleanStringList(value);
      if (required && items.length === 0) {
        throw new Error(`请至少填写一项${label}`);
      }
      if (items.length > maximum) {
        throw new Error(`${label}最多 ${maximum} 项`);
      }
      if (items.some((item) => item.length > 160)) {
        throw new Error(`${label}单项不能超过 160 个字符`);
      }
    },
  };
}

function buildPreviewPersona(values?: Partial<PersonaFormValues>): PersonaInput {
  return {
    name: values?.name?.trim() || FALLBACK_PERSONA.name,
    gender: values?.gender ?? FALLBACK_PERSONA.gender,
    age: typeof values?.age === "number" ? values.age : null,
    occupation: values?.occupation?.trim() ?? "",
    identity: values?.identity?.trim() || FALLBACK_PERSONA.identity,
    background: values?.background?.trim() ?? "",
    personalityTraits:
      cleanStringList(values?.personalityTraits).length > 0
        ? cleanStringList(values?.personalityTraits)
        : FALLBACK_PERSONA.personalityTraits,
    communicationStyle:
      values?.communicationStyle?.trim() ||
      FALLBACK_PERSONA.communicationStyle,
    behaviorNotes: values?.behaviorNotes?.trim() ?? "",
    motivations: cleanStringList(values?.motivations),
    concerns: cleanStringList(values?.concerns),
    voice: values?.voice ?? FALLBACK_PERSONA.voice,
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
  const [form] = Form.useForm<PersonaFormValues>();
  const [submitError, setSubmitError] = useState<string>();
  const draft = Form.useWatch([], form);

  const presetOptions = useMemo(
    () => buildPersonaPresetOptions(personaPresets, persona),
    [persona, personaPresets],
  );
  const missingRequiredPresets = persona
    ? []
    : Object.entries(REQUIRED_PRESET_LABELS)
        .filter(
          ([category]) =>
            presetOptions[category as PersonaPresetCategory].length === 0,
        )
        .map(([, label]) => label);
  const presetInitializationMessage =
    missingRequiredPresets.length > 0
      ? `缺少必要预设：${missingRequiredPresets.join("、")}。请先运行部署初始化脚本，再新建角色。`
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
    const previewPersona = buildPreviewPersona(draft);
    const previewScenario = selectedScenario ?? FALLBACK_SCENARIO;
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
  }, [draft, scenarios]);

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
            `与场景“${scenario.name}”组合后的 Instructions 过长（${issue.actualLength}/${issue.maximumLength} 字符），请精简角色配置。`,
          );
          return;
        }
      }
    }

    try {
      await onSubmit(normalizedInput);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "保存角色失败，请稍后重试。",
      );
    }
  };

  return (
    <Drawer
      className={styles.editorDrawer}
      extra={
        <Space>
          <Button disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button
            disabled={Boolean(presetInitializationMessage)}
            loading={busy}
            onClick={() => form.submit()}
            type="primary"
          >
            保存角色
          </Button>
        </Space>
      }
      keyboard={!busy}
      maskClosable={!busy}
      onClose={busy ? undefined : onCancel}
      open
      size="large"
      title={persona ? `编辑角色：${persona.name}` : "新建角色"}
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
          description="该表单的必填项只能从 SQLite 预设中选择，初始化完成后重新打开即可创建。"
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
      >
        <div className={styles.formGrid}>
          <Form.Item
            label="名字"
            name="name"
            rules={[{ required: true, whitespace: true, max: 80 }]}
          >
            <Input maxLength={80} placeholder="例如：小张" showCount />
          </Form.Item>
          <Form.Item
            label="性别"
            name="gender"
            rules={[{ required: true }]}
          >
            <Select options={GENDER_OPTIONS} />
          </Form.Item>
          <Form.Item label="年龄" name="age">
            <InputNumber
              className={styles.fullWidth}
              max={120}
              min={1}
              placeholder="可选"
              precision={0}
            />
          </Form.Item>
          <Form.Item
            extra="从预设中选择，可不填"
            label="职业"
            name="occupation"
            rules={[{ max: 120 }]}
          >
            <Select
              allowClear
              className={styles.fullWidth}
              notFoundContent="暂无可用职业预设"
              optionFilterProp="label"
              options={presetOptions.occupation}
              placeholder="选择职业"
              showSearch
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            extra="选择角色在对练中的身份和立场"
            label="身份"
            name="identity"
            rules={[{ required: true, max: 240 }]}
          >
            <Select
              className={styles.fullWidth}
              notFoundContent="暂无可用身份预设"
              optionFilterProp="label"
              options={presetOptions.identity}
              placeholder="选择身份"
              showSearch
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            label="背景"
            name="background"
            rules={[{ max: 2_000 }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 6 }}
              maxLength={2_000}
              placeholder="经历、当前处境、与销售场景相关的信息"
              showCount
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            extra="从预设中选择 1–12 项，可搜索和多选"
            label="性格特征"
            name="personalityTraits"
            rules={[listRule("性格特征", 12, true)]}
          >
            <Select
              allowClear
              className={styles.fullWidth}
              maxCount={12}
              maxTagCount="responsive"
              mode="multiple"
              notFoundContent="暂无可用性格预设"
              optionFilterProp="label"
              options={presetOptions.personality_trait}
              placeholder="选择性格特征"
              showSearch
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            extra="从预设中选择措辞、表达习惯和交流方式"
            label="沟通风格"
            name="communicationStyle"
            rules={[{ required: true, max: 500 }]}
          >
            <Select
              className={styles.fullWidth}
              notFoundContent="暂无可用沟通风格预设"
              optionFilterProp="label"
              options={presetOptions.communication_style}
              placeholder="选择沟通风格"
              showSearch
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            label="行为说明"
            name="behaviorNotes"
            rules={[{ max: 2_000 }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 6 }}
              maxLength={2_000}
              placeholder="角色在对练中应遵循的特殊行为规则"
              showCount
            />
          </Form.Item>
          <Form.Item
            extra="从预设中选择，最多 10 项"
            label="动机"
            name="motivations"
            rules={[listRule("动机", 10)]}
          >
            <Select
              allowClear
              className={styles.fullWidth}
              maxCount={10}
              maxTagCount="responsive"
              mode="multiple"
              notFoundContent="暂无可用动机预设"
              optionFilterProp="label"
              options={presetOptions.motivation}
              placeholder="选择角色动机"
              showSearch
            />
          </Form.Item>
          <Form.Item
            extra="从预设中选择，最多 10 项"
            label="顾虑与异议"
            name="concerns"
            rules={[listRule("顾虑与异议", 10)]}
          >
            <Select
              allowClear
              className={styles.fullWidth}
              maxCount={10}
              maxTagCount="responsive"
              mode="multiple"
              notFoundContent="暂无可用顾虑预设"
              optionFilterProp="label"
              options={presetOptions.concern}
              placeholder="选择顾虑与异议"
              showSearch
            />
          </Form.Item>
          <Form.Item
            label="音色"
            name="voice"
            rules={[{ required: true }]}
          >
            <Select options={VOICE_OPTIONS} />
          </Form.Item>
        </div>

        <Divider titlePlacement="start">提示词检查</Divider>
        {scenarios.length > 0 ? (
          <Form.Item label="用于预览的场景" name="previewScenarioId">
            <Select
              options={scenarios.map((scenario) => ({
                value: scenario.id,
                label: scenario.name,
              }))}
              placeholder="选择预览场景"
            />
          </Form.Item>
        ) : null}
        <PromptPreview
          note={
            scenarios.length === 0
              ? "目前没有场景，预览暂时使用通用销售沟通场景。"
              : undefined
          }
          lengthIssue={preview.lengthIssue}
          prompt={preview.prompt}
        />
      </Form>
    </Drawer>
  );
}
