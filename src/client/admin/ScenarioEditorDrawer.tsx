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
  PersonaPreset,
  Scenario,
  ScenarioInput,
} from "../../shared/role-play-catalog";
import {
  compileRolePlayInstructions,
  findRolePlayInstructionsLengthIssue,
} from "../../shared/role-play-instructions";
import {
  cleanStringList,
  getFallbackPersona,
  getInterruptFrequencyOptions,
  getSpeakingPaceOptions,
} from "./admin-options";
import { useI18n, type AppLocale } from "../i18n";
import { translate } from "../i18n/locale";
import {
  localizePersona,
  localizeScenario,
} from "../catalog/catalog-localization";
import { PromptPreview } from "./PromptPreview";
import styles from "./AdminConsole.module.css";

type ScenarioFormValues = ScenarioInput & { previewPersonaId?: string };

interface ScenarioEditorDrawerProps {
  scenario?: Scenario;
  personas: Persona[];
  personaPresets: PersonaPreset[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: ScenarioInput) => Promise<void>;
}

function listRule(locale: AppLocale, label: string, maximum: number) {
  return {
    validator: async (_rule: unknown, value: unknown) => {
      const items = cleanStringList(value);
      if (items.length === 0) {
        throw new Error(
          translate(
            locale,
            {
              en: "Enter at least one {label}.",
              zh: "请至少填写一项{label}。",
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
              zh: "{label}最多可填写 {maximum} 项。",
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

function buildPreviewScenario(
  locale: AppLocale,
  values?: Partial<ScenarioFormValues>,
): ScenarioInput {
  return {
    name:
      values?.name?.trim() ||
      translate(locale, { en: "Untitled scenario", zh: "未命名场景" }),
    description:
      values?.description?.trim() ||
      translate(locale, {
        en: "A salesperson is having a business conversation with a customer.",
        zh: "销售人员正在与客户进行业务沟通。",
      }),
    goals:
      cleanStringList(values?.goals).length > 0
        ? cleanStringList(values?.goals)
        : [translate(locale, { en: "Understand customer needs", zh: "了解客户需求" })],
    suggestedSkillFocus:
      cleanStringList(values?.suggestedSkillFocus).length > 0
        ? cleanStringList(values?.suggestedSkillFocus)
        : [translate(locale, { en: "Needs discovery", zh: "需求发现" })],
    successCriteria:
      cleanStringList(values?.successCriteria).length > 0
        ? cleanStringList(values?.successCriteria)
        : [
            translate(locale, {
              en: "Move the conversation forward around the customer's needs",
              zh: "围绕客户需求推进对话",
            }),
          ],
    scoringCriteria: Array.isArray(values?.scoringCriteria)
      ? values.scoringCriteria
          .filter(
            (criterion) =>
              criterion &&
              typeof criterion.name === "string" &&
              typeof criterion.weight === "number",
          )
          .map((criterion) => ({
            name:
              criterion.name.trim() ||
              translate(locale, {
                en: "Untitled scoring criterion",
                zh: "未命名评分项",
              }),
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
        values?.voiceBehavior?.toneStyle?.trim() ||
        translate(locale, {
          en: "Natural, realistic, and measured",
          zh: "自然、真实、克制",
        }),
    },
  };
}

export function ScenarioEditorDrawer({
  scenario,
  personas,
  personaPresets,
  busy,
  onCancel,
  onSubmit,
}: ScenarioEditorDrawerProps) {
  const { locale, t } = useI18n();
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
      toneStyle: t({
        en: "Natural, realistic, and measured",
        zh: "自然、真实、克制",
      }),
    },
    previewPersonaId: initialAllowedPersonaIds[0],
  };

  const preview = useMemo(() => {
    const selectedPersona = personas.find(
      (persona) => persona.id === draft?.previewPersonaId,
    );
    const previewPersona = selectedPersona
      ? localizePersona(selectedPersona, locale, personaPresets)
      : getFallbackPersona(locale);
    const previewScenario = buildPreviewScenario(locale, draft);
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
  }, [draft, locale, personaPresets, personas]);

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
          t(
            {
              en: "The Instructions generated with persona “{name}” are too long ({actual}/{maximum} characters). Shorten the scenario or persona configuration.",
              zh: "与角色“{name}”组合后的 Instructions 过长（{actual}/{maximum} 字符），请精简场景或角色配置。",
            },
            {
              name: localizePersona(persona, locale).name,
              actual: issue.actualLength,
              maximum: issue.maximumLength,
            },
          ),
        );
        return;
      }
    }

    try {
      await onSubmit(normalizedInput);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t({
              en: "Could not save the scenario. Try again later.",
              zh: "保存场景失败，请稍后重试。",
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
          <Button loading={busy} onClick={() => form.submit()} type="primary">
            {t({ en: "Save scenario", zh: "保存场景" })}
          </Button>
        </Space>
      }
      keyboard={!busy}
      maskClosable={!busy}
      onClose={busy ? undefined : onCancel}
      open
      size="large"
      title={
        scenario
          ? t(
              { en: "Edit scenario: {name}", zh: "编辑场景：{name}" },
              { name: localizeScenario(scenario, locale).name },
            )
          : t({ en: "New scenario", zh: "新建场景" })
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
      {personas.length === 0 ? (
        <Alert
          className={styles.formAlert}
          title={t({
            en: "Create at least one persona first. Every scenario must specify an available persona.",
            zh: "请先新建至少一个角色，场景必须指定可用角色。",
          })}
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
          array: {
            min: t({
              en: "Select at least ${min} ${label}.",
              zh: "请至少选择 ${min} 项${label}。",
            }),
          },
        }}
      >
        <Form.Item
          label={t({ en: "Scenario name", zh: "场景名称" })}
          name="name"
          rules={[{ required: true, whitespace: true, max: 120 }]}
        >
          <Input
            maxLength={120}
            placeholder={t({
              en: "For example: Initial needs discovery",
              zh: "例如：首次需求发现",
            })}
            showCount
          />
        </Form.Item>
        <Form.Item
          label={t({ en: "Scenario description", zh: "场景描述" })}
          name="description"
          rules={[{ required: true, whitespace: true, max: 2_000 }]}
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 7 }}
            maxLength={2_000}
            placeholder={t({
              en: "Describe the business context and the situation of the salesperson and customer",
              zh: "说明业务背景、销售人员和客户所处的情境",
            })}
            showCount
          />
        </Form.Item>
        <div className={styles.formGrid}>
          <Form.Item
            extra={t({
              en: "Press Enter after each item",
              zh: "输入一项后按 Enter",
            })}
            label={t({ en: "Training goals", zh: "训练目标" })}
            name="goals"
            rules={[
              listRule(
                locale,
                t({ en: "training goal", zh: "训练目标" }),
                10,
              ),
            ]}
          >
            <Select
              maxCount={10}
              mode="tags"
              placeholder={t({
                en: "What should the learner accomplish in this practice session?",
                zh: "学员应在本次对练中达成什么",
              })}
              tokenSeparators={[",", "，"]}
            />
          </Form.Item>
          <Form.Item
            extra={t({
              en: "Press Enter after each item",
              zh: "输入一项后按 Enter",
            })}
            label={t({ en: "Focus skills", zh: "重点技能" })}
            name="suggestedSkillFocus"
            rules={[
              listRule(
                locale,
                t({ en: "focus skill", zh: "重点技能" }),
                10,
              ),
            ]}
          >
            <Select
              maxCount={10}
              mode="tags"
              placeholder={t({
                en: "For example: Needs discovery, objection handling",
                zh: "例如：需求发现、异议处理",
              })}
              tokenSeparators={[",", "，"]}
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            extra={t({
              en: "Press Enter after each item. These criteria are sent to the model as hidden configuration",
              zh: "输入一项后按 Enter；这些条件会作为隐藏配置传给模型",
            })}
            label={t({ en: "Success criteria", zh: "成功标准" })}
            name="successCriteria"
            rules={[
              listRule(
                locale,
                t({ en: "success criterion", zh: "成功标准" }),
                12,
              ),
            ]}
          >
            <Select
              maxCount={12}
              mode="tags"
              placeholder={t({
                en: "For example: Confirm the budget, agree on the next step",
                zh: "例如：确认预算、明确下一步",
              })}
              tokenSeparators={[",", "，"]}
            />
          </Form.Item>
        </div>

        <Divider titlePlacement="start">
          {t({ en: "Scoring configuration", zh: "评分配置" })}
        </Divider>
        <Form.List
          name="scoringCriteria"
          rules={[
            {
              validator: async (_rule, value: unknown) => {
                if (!Array.isArray(value) || value.length === 0) return;
                if (value.length > 12) {
                  throw new Error(
                    t({
                      en: "You can add up to 12 scoring criteria.",
                      zh: "评分项最多 12 项。",
                    }),
                  );
                }
                const total = value.reduce(
                  (sum, item) =>
                    sum +
                    (typeof item?.weight === "number" ? item.weight : 0),
                  0,
                );
                if (total !== 100) {
                  throw new Error(
                    t(
                      {
                        en: "Scoring weights must total 100%. The current total is {total}%.",
                        zh: "评分权重总和必须为 100%，当前为 {total}%。",
                      },
                      { total },
                    ),
                  );
                }
                const normalizedNames = value
                  .map((item) =>
                    typeof item?.name === "string"
                      ? item.name.trim().toLocaleLowerCase()
                      : "",
                  )
                  .filter(Boolean);
                if (new Set(normalizedNames).size !== normalizedNames.length) {
                  throw new Error(
                    t({
                      en: "Scoring criterion names must be unique.",
                      zh: "评分项名称不能重复。",
                    }),
                  );
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
                      aria-label={t(
                        {
                          en: "Scoring criterion {index} name",
                          zh: "评分项 {index} 名称",
                        },
                        { index: field.name + 1 },
                      )}
                      maxLength={100}
                      placeholder={t({
                        en: "Criterion name",
                        zh: "评分项名称",
                      })}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "weight"]}
                    noStyle
                    rules={[{ required: true, type: "number", min: 0, max: 100 }]}
                  >
                    <InputNumber
                      aria-label={t(
                        {
                          en: "Scoring criterion {index} weight",
                          zh: "评分项 {index} 权重",
                        },
                        { index: field.name + 1 },
                      )}
                      className={styles.fullWidth}
                      max={100}
                      min={0}
                      placeholder={t({ en: "Weight", zh: "权重" })}
                      precision={0}
                      suffix="%"
                    />
                  </Form.Item>
                  <Button
                    aria-label={t(
                      {
                        en: "Delete scoring criterion {index}",
                        zh: "删除评分项 {index}",
                      },
                      { index: field.name + 1 },
                    )}
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
                {t({ en: "Add scoring criterion", zh: "添加评分项" })}
              </Button>
              <Form.ErrorList errors={errors} />
            </Space>
          )}
        </Form.List>

        <Divider titlePlacement="start">
          {t({ en: "Personas and voice behavior", zh: "角色与语音行为" })}
        </Divider>
        <Form.Item
          extra={t({
            en: "Only selected personas can be used in this scenario",
            zh: "只有选中的角色可以用于这个场景",
          })}
          label={t({ en: "Available personas", zh: "可用角色" })}
          name="allowedPersonaIds"
          rules={[
            {
              required: true,
              type: "array",
              min: 1,
              message: t({
                en: "Select at least one persona.",
                zh: "请至少选择一个角色。",
              }),
            },
          ]}
        >
          <Select
            maxCount={100}
            mode="multiple"
            optionFilterProp="label"
            options={personas.map((persona) => {
              const displayPersona = localizePersona(
                persona,
                locale,
                personaPresets,
              );
              return {
                value: persona.id,
                label: `${displayPersona.name} · ${displayPersona.identity}`,
              };
            })}
            placeholder={t({
              en: "Select personas available in this scenario",
              zh: "选择这个场景可以使用的角色",
            })}
            showSearch
          />
        </Form.Item>
        <div className={styles.formGrid}>
          <Form.Item
            extra={t({
              en: "Controls interjections and challenges during the persona's response; it cannot take the microphone while the learner is holding to talk",
              zh: "控制角色轮到回应时的插话/挑战倾向；按住说话期间不会主动抢麦",
            })}
            label={t({
              en: "Interjection / challenge tendency",
              zh: "插话 / 挑战倾向",
            })}
            name={["voiceBehavior", "interruptFrequency"]}
            rules={[{ required: true }]}
          >
            <Select options={getInterruptFrequencyOptions(locale)} />
          </Form.Item>
          <Form.Item
            label={t({ en: "Speaking pace", zh: "说话节奏" })}
            name={["voiceBehavior", "speakingPace"]}
            rules={[{ required: true }]}
          >
            <Select options={getSpeakingPaceOptions(locale)} />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            label={t({ en: "Tone style", zh: "语气风格" })}
            name={["voiceBehavior", "toneStyle"]}
            rules={[{ required: true, whitespace: true, max: 160 }]}
          >
            <Input
              maxLength={160}
              placeholder={t({
                en: "For example: Friendly but cautious; probes vague commitments",
                zh: "例如：友善但谨慎，遇到模糊承诺时会追问",
              })}
              showCount
            />
          </Form.Item>
        </div>

        <Divider titlePlacement="start">
          {t({ en: "Instructions check", zh: "提示词检查" })}
        </Divider>
        <Form.Item
          extra={t({
            en: "Used only for the preview; this does not change available personas",
            zh: "只用于预览，不会改变场景的可用角色配置",
          })}
          label={t({
            en: "Compatible persona used for preview",
            zh: "用于预览的兼容角色",
          })}
          name="previewPersonaId"
          rules={[
            {
              validator: async (_rule, value: unknown) => {
                if (compatiblePersonas.length > 0 && !value) {
                  throw new Error(
                    t({
                      en: "Select a compatible persona for the preview.",
                      zh: "请选择一个兼容角色用于预览。",
                    }),
                  );
                }
              },
            },
          ]}
        >
          <Select
            disabled={compatiblePersonas.length === 0}
            options={compatiblePersonas.map((persona) => ({
              value: persona.id,
              label: localizePersona(
                persona,
                locale,
                personaPresets,
              ).name,
            }))}
            placeholder={
              compatiblePersonas.length > 0
                ? t({ en: "Select a preview persona", zh: "选择预览角色" })
                : t({
                    en: "Select available personas above first",
                    zh: "请先在上方选择可用角色",
                  })
            }
          />
        </Form.Item>
        {compatiblePersonas.length === 0 ? (
          <Typography.Text type="secondary">
            {t({
              en: "Select an available persona to check the complete Instructions sent to the voice model.",
              zh: "选择可用角色后，即可检查最终发送给语音模型的完整 Instructions。",
            })}
          </Typography.Text>
        ) : null}
        <PromptPreview
          lengthIssue={preview.lengthIssue}
          note={
            compatiblePersonas.length === 0
              ? t({
                  en: "The preview currently uses a placeholder persona. Select at least one available persona before saving.",
                  zh: "当前使用占位角色生成预览；保存前必须选择至少一个可用角色。",
                })
              : undefined
          }
          prompt={preview.prompt}
        />
      </Form>
    </Drawer>
  );
}
