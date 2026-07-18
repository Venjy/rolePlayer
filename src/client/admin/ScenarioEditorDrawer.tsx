import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
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
  Typography,
} from "antd";
import type {
  Persona,
  Scenario,
  ScenarioInput,
} from "../../shared/role-play-catalog";
import {
  compileRolePlayInstructions,
  findRolePlayInstructionsLengthIssue,
} from "../../shared/role-play-instructions";
import {
  cleanStringList,
  FALLBACK_PERSONA,
  INTERRUPT_FREQUENCY_OPTIONS,
  SPEAKING_PACE_OPTIONS,
} from "./admin-options";
import { PromptPreview } from "./PromptPreview";
import styles from "./AdminConsole.module.css";

type ScenarioFormValues = ScenarioInput & { previewPersonaId?: string };

interface ScenarioEditorDrawerProps {
  scenario?: Scenario;
  personas: Persona[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: ScenarioInput) => Promise<void>;
}

function listRule(label: string, maximum: number) {
  return {
    validator: async (_rule: unknown, value: unknown) => {
      const items = cleanStringList(value);
      if (items.length === 0) {
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

function buildPreviewScenario(
  values?: Partial<ScenarioFormValues>,
): ScenarioInput {
  return {
    name: values?.name?.trim() || "未命名场景",
    description:
      values?.description?.trim() || "销售人员正在与客户进行业务沟通。",
    goals:
      cleanStringList(values?.goals).length > 0
        ? cleanStringList(values?.goals)
        : ["了解客户需求"],
    suggestedSkillFocus:
      cleanStringList(values?.suggestedSkillFocus).length > 0
        ? cleanStringList(values?.suggestedSkillFocus)
        : ["需求发现"],
    successCriteria:
      cleanStringList(values?.successCriteria).length > 0
        ? cleanStringList(values?.successCriteria)
        : ["围绕客户需求推进对话"],
    scoringCriteria: Array.isArray(values?.scoringCriteria)
      ? values.scoringCriteria
          .filter(
            (criterion) =>
              criterion &&
              typeof criterion.name === "string" &&
              typeof criterion.weight === "number",
          )
          .map((criterion) => ({
            name: criterion.name.trim() || "未命名评分项",
            weight: criterion.weight,
          }))
      : [],
    allowedPersonaIds:
      cleanStringList(values?.allowedPersonaIds).length > 0
        ? cleanStringList(values?.allowedPersonaIds)
        : ["preview-persona"],
    voiceBehavior: {
      interruptFrequency:
        values?.voiceBehavior?.interruptFrequency ?? "medium",
      speakingPace: values?.voiceBehavior?.speakingPace ?? "normal",
      toneStyle:
        values?.voiceBehavior?.toneStyle?.trim() || "自然、真实、克制",
    },
  };
}

export function ScenarioEditorDrawer({
  scenario,
  personas,
  busy,
  onCancel,
  onSubmit,
}: ScenarioEditorDrawerProps) {
  const [form] = Form.useForm<ScenarioFormValues>();
  const [submitError, setSubmitError] = useState<string>();
  const draft = Form.useWatch([], form);
  const allowedPersonaIds = Form.useWatch("allowedPersonaIds", form) ?? [];
  const compatiblePersonas = personas.filter((persona) =>
    allowedPersonaIds.includes(persona.id),
  );

  const initialAllowedPersonaIds =
    scenario?.allowedPersonaIds.filter((id) =>
      personas.some((persona) => persona.id === id),
    ) ?? [];
  const initialValues: ScenarioFormValues = {
    name: scenario?.name ?? "",
    description: scenario?.description ?? "",
    goals: scenario?.goals ?? [],
    suggestedSkillFocus: scenario?.suggestedSkillFocus ?? [],
    successCriteria: scenario?.successCriteria ?? [],
    scoringCriteria: scenario?.scoringCriteria ?? [],
    allowedPersonaIds: initialAllowedPersonaIds,
    voiceBehavior: scenario?.voiceBehavior ?? {
      interruptFrequency: "medium",
      speakingPace: "normal",
      toneStyle: "自然、真实、克制",
    },
    previewPersonaId: initialAllowedPersonaIds[0],
  };

  const preview = useMemo(() => {
    const selectedPersona = personas.find(
      (persona) => persona.id === draft?.previewPersonaId,
    );
    const previewPersona = selectedPersona ?? FALLBACK_PERSONA;
    const previewScenario = buildPreviewScenario(draft);
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
  }, [draft, personas]);

  const handleValuesChange = (
    changed: Partial<ScenarioFormValues>,
    values: ScenarioFormValues,
  ) => {
    if (!changed.allowedPersonaIds) return;
    if (values.previewPersonaId && changed.allowedPersonaIds.includes(values.previewPersonaId)) {
      return;
    }
    form.setFieldValue("previewPersonaId", changed.allowedPersonaIds[0]);
  };

  const handleFinish = async (values: ScenarioFormValues) => {
    setSubmitError(undefined);
    const input = { ...values };
    delete input.previewPersonaId;
    const normalizedInput: ScenarioInput = {
      ...input,
      description: input.description.trim(),
      goals: cleanStringList(input.goals),
      suggestedSkillFocus: cleanStringList(input.suggestedSkillFocus),
      successCriteria: cleanStringList(input.successCriteria),
      allowedPersonaIds: cleanStringList(input.allowedPersonaIds),
      scoringCriteria: input.scoringCriteria.map((criterion) => ({
        name: criterion.name.trim(),
        weight: criterion.weight,
      })),
      voiceBehavior: {
        ...input.voiceBehavior,
        toneStyle: input.voiceBehavior.toneStyle.trim(),
      },
    };

    for (const persona of personas) {
      if (!normalizedInput.allowedPersonaIds.includes(persona.id)) continue;
      const issue = findRolePlayInstructionsLengthIssue({
        persona,
        scenario: normalizedInput,
      });
      if (issue) {
        setSubmitError(
          `与角色“${persona.name}”组合后的 Instructions 过长（${issue.actualLength}/${issue.maximumLength} 字符），请精简场景或角色配置。`,
        );
        return;
      }
    }

    try {
      await onSubmit(normalizedInput);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "保存场景失败，请稍后重试。",
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
          <Button loading={busy} onClick={() => form.submit()} type="primary">
            保存场景
          </Button>
        </Space>
      }
      keyboard={!busy}
      maskClosable={!busy}
      onClose={busy ? undefined : onCancel}
      open
      size="large"
      title={scenario ? `编辑场景：${scenario.name}` : "新建场景"}
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
      {personas.length === 0 ? (
        <Alert
          className={styles.formAlert}
          title="请先新建至少一个角色，场景必须指定可用角色。"
          showIcon
          type="warning"
        />
      ) : null}
      <Form<ScenarioFormValues>
        form={form}
        initialValues={initialValues}
        layout="vertical"
        onFinish={handleFinish}
        onValuesChange={handleValuesChange}
        requiredMark="optional"
      >
        <Form.Item
          label="场景名称"
          name="name"
          rules={[{ required: true, whitespace: true, max: 120 }]}
        >
          <Input maxLength={120} placeholder="例如：首次需求发现" showCount />
        </Form.Item>
        <Form.Item
          label="场景描述"
          name="description"
          rules={[{ required: true, whitespace: true, max: 2_000 }]}
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 7 }}
            maxLength={2_000}
            placeholder="说明业务背景、销售人员和客户所处的情境"
            showCount
          />
        </Form.Item>
        <div className={styles.formGrid}>
          <Form.Item
            extra="输入一项后按 Enter"
            label="训练目标"
            name="goals"
            rules={[listRule("训练目标", 10)]}
          >
            <Select
              maxCount={10}
              mode="tags"
              placeholder="学员应在本次对练中达成什么"
              tokenSeparators={[",", "，"]}
            />
          </Form.Item>
          <Form.Item
            extra="输入一项后按 Enter"
            label="重点技能"
            name="suggestedSkillFocus"
            rules={[listRule("重点技能", 10)]}
          >
            <Select
              maxCount={10}
              mode="tags"
              placeholder="例如：需求发现、异议处理"
              tokenSeparators={[",", "，"]}
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            extra="输入一项后按 Enter；这些条件会作为隐藏配置传给模型"
            label="成功标准"
            name="successCriteria"
            rules={[listRule("成功标准", 12)]}
          >
            <Select
              maxCount={12}
              mode="tags"
              placeholder="例如：确认预算、明确下一步"
              tokenSeparators={[",", "，"]}
            />
          </Form.Item>
        </div>

        <Divider titlePlacement="start">评分配置</Divider>
        <Form.List
          name="scoringCriteria"
          rules={[
            {
              validator: async (_rule, value: unknown) => {
                if (!Array.isArray(value) || value.length === 0) return;
                if (value.length > 12) {
                  throw new Error("评分项最多 12 项");
                }
                const total = value.reduce(
                  (sum, item) =>
                    sum +
                    (typeof item?.weight === "number" ? item.weight : 0),
                  0,
                );
                if (total !== 100) {
                  throw new Error(`评分权重总和必须为 100%，当前为 ${total}%`);
                }
                const normalizedNames = value
                  .map((item) =>
                    typeof item?.name === "string"
                      ? item.name.trim().toLocaleLowerCase()
                      : "",
                  )
                  .filter(Boolean);
                if (new Set(normalizedNames).size !== normalizedNames.length) {
                  throw new Error("评分项名称不能重复");
                }
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <Space
              className={styles.scoringList}
              orientation="vertical"
              size="small"
            >
              {fields.map((field) => (
                <div className={styles.scoringRow} key={field.key}>
                  <Form.Item
                    name={[field.name, "name"]}
                    noStyle
                    rules={[
                      { required: true, whitespace: true, max: 100 },
                    ]}
                  >
                    <Input
                      aria-label={`评分项 ${field.name + 1} 名称`}
                      maxLength={100}
                      placeholder="评分项名称"
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "weight"]}
                    noStyle
                    rules={[{ required: true, type: "number", min: 0, max: 100 }]}
                  >
                    <InputNumber
                      aria-label={`评分项 ${field.name + 1} 权重`}
                      className={styles.fullWidth}
                      max={100}
                      min={0}
                      placeholder="权重"
                      precision={0}
                      suffix="%"
                    />
                  </Form.Item>
                  <Button
                    aria-label={`删除评分项 ${field.name + 1}`}
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => remove(field.name)}
                    type="text"
                  />
                </div>
              ))}
              <Button
                disabled={fields.length >= 12}
                icon={<PlusOutlined />}
                onClick={() => add({ name: "", weight: 0 })}
                type="dashed"
              >
                添加评分项
              </Button>
              <Form.ErrorList errors={errors} />
            </Space>
          )}
        </Form.List>

        <Divider titlePlacement="start">角色与语音行为</Divider>
        <Form.Item
          extra="只有选中的角色可以用于这个场景"
          label="可用角色"
          name="allowedPersonaIds"
          rules={[
            {
              required: true,
              type: "array",
              min: 1,
              message: "请至少选择一个角色",
            },
          ]}
        >
          <Select
            maxCount={100}
            mode="multiple"
            optionFilterProp="label"
            options={personas.map((persona) => ({
              value: persona.id,
              label: `${persona.name} · ${persona.identity}`,
            }))}
            placeholder="选择这个场景可以使用的角色"
            showSearch
          />
        </Form.Item>
        <div className={styles.formGrid}>
          <Form.Item
            extra="控制角色轮到回应时的插话/挑战倾向；按住说话期间不会主动抢麦"
            label="插话 / 挑战倾向"
            name={["voiceBehavior", "interruptFrequency"]}
            rules={[{ required: true }]}
          >
            <Select options={INTERRUPT_FREQUENCY_OPTIONS} />
          </Form.Item>
          <Form.Item
            label="说话节奏"
            name={["voiceBehavior", "speakingPace"]}
            rules={[{ required: true }]}
          >
            <Select options={SPEAKING_PACE_OPTIONS} />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            label="语气风格"
            name={["voiceBehavior", "toneStyle"]}
            rules={[{ required: true, whitespace: true, max: 160 }]}
          >
            <Input
              maxLength={160}
              placeholder="例如：友善但谨慎，遇到模糊承诺时会追问"
              showCount
            />
          </Form.Item>
        </div>

        <Divider titlePlacement="start">提示词检查</Divider>
        <Form.Item
          extra="只用于预览，不会改变场景的可用角色配置"
          label="用于预览的兼容角色"
          name="previewPersonaId"
          rules={[
            {
              validator: async (_rule, value: unknown) => {
                if (compatiblePersonas.length > 0 && !value) {
                  throw new Error("请选择一个兼容角色用于预览");
                }
              },
            },
          ]}
        >
          <Select
            disabled={compatiblePersonas.length === 0}
            options={compatiblePersonas.map((persona) => ({
              value: persona.id,
              label: persona.name,
            }))}
            placeholder={
              compatiblePersonas.length > 0
                ? "选择预览角色"
                : "请先在上方选择可用角色"
            }
          />
        </Form.Item>
        {compatiblePersonas.length === 0 ? (
          <Typography.Text type="secondary">
            选择可用角色后，即可检查最终发送给语音模型的完整 Instructions。
          </Typography.Text>
        ) : null}
        <PromptPreview
          lengthIssue={preview.lengthIssue}
          note={
            compatiblePersonas.length === 0
              ? "当前使用占位角色生成预览；保存前必须选择至少一个可用角色。"
              : undefined
          }
          prompt={preview.prompt}
        />
      </Form>
    </Drawer>
  );
}
