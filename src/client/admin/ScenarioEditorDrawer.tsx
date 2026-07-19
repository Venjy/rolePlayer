import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  ConfigProvider,
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
  Scenario,
  ScenarioInput,
  ScenarioPreset,
} from "../../shared/role-play-catalog";
import { compileScenarioInstructions } from "../../shared/role-play-instructions";
import { resolveScenarioPresetReferences } from "../../shared/role-play-preset-resolution";
import {
  getInterruptFrequencyOptions,
  getScenarioPresetOptions,
  getSpeakingPaceOptions,
} from "./admin-options";
import { useI18n, type AppLocale } from "../i18n";
import { translate } from "../i18n/locale";
import { localizeScenario, localizeScenarioInput } from "../catalog/catalog-localization";
import { generateScenarioDraft } from "../catalog/catalog-api";
import { getCatalogGenerationErrorMessage } from "./catalog-generation-errors";
import { PromptPreview } from "./PromptPreview";
import {
  buildScoringCriteriaForSuccessCriteria,
  getScenarioFormInitialValues,
  normalizeScenarioFormValues,
  type ScenarioFormValues,
} from "./scenario-form-values";
import styles from "./AdminConsole.module.css";

interface ScenarioEditorDrawerProps {
  scenario?: Scenario;
  /** New scenarios initially allow these personas; compatibility is edited elsewhere. */
  defaultAllowedPersonaIds: number[];
  scenarioPresets: ScenarioPreset[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: ScenarioInput) => Promise<void>;
}

function listRule(locale: AppLocale, label: string, maximum: number) {
  return {
    validator: async (_rule: unknown, value: unknown) => {
      const items = Array.isArray(value) ? value : [];
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
    },
  };
}

export function ScenarioEditorDrawer({
  scenario,
  defaultAllowedPersonaIds,
  scenarioPresets,
  busy,
  onCancel,
  onSubmit,
}: ScenarioEditorDrawerProps) {
  const { locale, t } = useI18n();
  const [form] = Form.useForm<ScenarioFormValues>();
  const [submitError, setSubmitError] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const [generatedScenario, setGeneratedScenario] = useState<ScenarioInput>();
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationRequestRef = useRef(0);
  const draft = Form.useWatch([], form);
  const baseScenario = generatedScenario ?? scenario;
  const locked = busy || generating;
  const initialValues = useMemo(
    () => getScenarioFormInitialValues(baseScenario, locale, scenarioPresets),
    [baseScenario, locale, scenarioPresets],
  );

  const preview = useMemo(() => {
    const previewInput = normalizeScenarioFormValues(
      { ...initialValues, ...draft },
      locale,
      baseScenario,
      defaultAllowedPersonaIds,
    );
    const previewScenario = localizeScenarioInput(
      resolveScenarioPresetReferences(previewInput, scenarioPresets),
      locale,
    );
    return compileScenarioInstructions(previewScenario, locale);
  }, [baseScenario, defaultAllowedPersonaIds, draft, initialValues, locale, scenarioPresets]);

  const handleValuesChange = (changed: Partial<ScenarioFormValues>) => {
    if (!changed.successCriterionPresetIds) return;
    const successCriteria = changed.successCriterionPresetIds;
    form.setFieldValue(
      "scoringCriteria",
      buildScoringCriteriaForSuccessCriteria(
        successCriteria,
        scenarioPresets,
        locale,
      ),
    );
  };

  const handleFinish = async (values: ScenarioFormValues) => {
    setSubmitError(undefined);
    const normalizedInput = normalizeScenarioFormValues(
      values,
      locale,
      baseScenario,
      defaultAllowedPersonaIds,
    );
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

  const handleGenerate = async () => {
    const requestId = generationRequestRef.current + 1;
    const controller = new AbortController();
    generationRequestRef.current = requestId;
    generationAbortRef.current = controller;
    setSubmitError(undefined);
    setGenerating(true);
    try {
      const currentDraft = normalizeScenarioFormValues(
        { ...initialValues, ...form.getFieldsValue(true) },
        locale,
        baseScenario,
        defaultAllowedPersonaIds,
      );
      const generated = await generateScenarioDraft(
        currentDraft,
        controller.signal,
      );
      if (generationRequestRef.current !== requestId) return;
      setGeneratedScenario(generated);
      form.setFieldsValue(
        getScenarioFormInitialValues(generated, locale, scenarioPresets),
      );
    } catch (error) {
      if (generationRequestRef.current !== requestId) return;
      setSubmitError(
        getCatalogGenerationErrorMessage(error, locale, "scenario"),
      );
    } finally {
      if (generationRequestRef.current === requestId) {
        generationAbortRef.current = null;
        setGenerating(false);
      }
    }
  };

  const handleCancel = () => {
    generationRequestRef.current += 1;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    onCancel();
  };

  useEffect(
    () => () => {
      generationRequestRef.current += 1;
      generationAbortRef.current?.abort();
    },
    [],
  );

  return (
    <Drawer
      className={styles.editorDrawer}
      extra={
        <Space>
          <Button disabled={busy} onClick={handleCancel}>
            {t({ en: "Cancel", zh: "取消" })}
          </Button>
          {!scenario ? (
            <ConfigProvider
              button={{ className: styles.linearGradientButton }}
            >
              <Button
                disabled={locked}
                icon={<span aria-hidden="true">✨</span>}
                onClick={() => void handleGenerate()}
                type="primary"
              >
                <span className={styles.wideActionLabel}>
                  {t({ en: "Random generate", zh: "随机生成" })}
                </span>
                <span className={styles.narrowActionLabel}>
                  {t({ en: "Generate", zh: "随机生成" })}
                </span>
                {generating ? <LoadingOutlined spin /> : null}
              </Button>
            </ConfigProvider>
          ) : null}
          <Button
            disabled={locked}
            loading={busy}
            onClick={() => form.submit()}
            type="primary"
          >
            <span className={styles.wideActionLabel}>
              {t({ en: "Save scenario", zh: "保存场景" })}
            </span>
            <span className={styles.narrowActionLabel}>
              {t({ en: "Save", zh: "保存" })}
            </span>
          </Button>
        </Space>
      }
      keyboard={!locked}
      mask={{ closable: Boolean(scenario) && !locked }}
      onClose={locked ? undefined : onCancel}
      open
      size="min(736px, 100vw)"
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
      <Form<ScenarioFormValues>
        form={form}
        disabled={locked}
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
        }}
      >
        <Form.Item
          label={t({ en: "Scenario name", zh: "场景名称" })}
          name="name"
          rules={[{ required: true, whitespace: true, max: 120 }]}
        >
          <Input maxLength={120} showCount />
        </Form.Item>
        <Form.Item
          label={t({ en: "Scenario description", zh: "场景描述" })}
          name="description"
          rules={[{ required: true, whitespace: true, max: 2_000 }]}
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 7 }}
            maxLength={2_000}
            showCount
          />
        </Form.Item>
        <div className={styles.formGrid}>
          <Form.Item
            label={t({ en: "Training goals", zh: "训练目标" })}
            name="trainingGoalPresetIds"
            rules={[
              {
                required: true,
                type: "array",
                min: 1,
                message: t({
                  en: "Select at least one training goal.",
                  zh: "请至少选择一项训练目标。",
                }),
              },
              listRule(locale, t({ en: "training goal", zh: "训练目标" }), 10),
            ]}
          >
            <Select
              maxCount={10}
              mode="multiple"
              options={getScenarioPresetOptions(scenarioPresets, "training_goal", locale)}
            />
          </Form.Item>
          <Form.Item
            label={t({ en: "Focus skills", zh: "重点技能" })}
            name="skillFocusPresetIds"
            rules={[
              {
                required: true,
                type: "array",
                min: 1,
                message: t({
                  en: "Select at least one focus skill.",
                  zh: "请至少选择一项重点技能。",
                }),
              },
              listRule(locale, t({ en: "focus skill", zh: "重点技能" }), 10),
            ]}
          >
            <Select
              maxCount={10}
              mode="multiple"
              options={getScenarioPresetOptions(scenarioPresets, "skill_focus", locale)}
            />
          </Form.Item>
          <Form.Item
            className={styles.fullSpan}
            extra={t({
              en: "The selected criteria become the scoring items below.",
              zh: "所选成功标准会自动成为下方评分项。",
            })}
            label={t({ en: "Success criteria", zh: "成功标准" })}
            name="successCriterionPresetIds"
            rules={[
              {
                required: true,
                type: "array",
                min: 1,
                message: t({
                  en: "Select at least one success criterion.",
                  zh: "请至少选择一项成功标准。",
                }),
              },
              listRule(locale, t({ en: "success criterion", zh: "成功标准" }), 12),
            ]}
          >
            <Select
              maxCount={12}
              mode="multiple"
              options={getScenarioPresetOptions(scenarioPresets, "success_criterion", locale)}
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
                const total = value.reduce(
                  (sum, item) =>
                    sum + (typeof item?.weight === "number" ? item.weight : 0),
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
              },
            },
          ]}
        >
          {(fields, _operations, { errors }) => (
            <Space className={styles.scoringList} orientation="vertical" size="small">
              {fields.map((field) => (
                <div className={styles.readonlyScoringRow} key={field.key}>
                  <Form.Item hidden name={[field.name, "successCriterionPresetId"]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name={[field.name, "displayName"]} noStyle>
                    <Input readOnly />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "weight"]}
                    noStyle
                    rules={[{ required: true, type: "number", min: 0, max: 100 }]}
                  >
                    <InputNumber
                      className={styles.fullWidth}
                      max={100}
                      min={0}
                      precision={0}
                      suffix="%"
                    />
                  </Form.Item>
                </div>
              ))}
              {fields.length === 0 ? (
                <Typography.Text type="secondary">
                  {t({
                    en: "Select success criteria to generate scoring weights.",
                    zh: "选择成功标准后会自动生成评分权重。",
                  })}
                </Typography.Text>
              ) : null}
              <Form.ErrorList errors={errors} />
            </Space>
          )}
        </Form.List>

        <Divider titlePlacement="start">
          {t({ en: "Voice behavior", zh: "语音行为" })}
        </Divider>
        <Typography.Paragraph type="secondary">
          {t({
            en: "Optional scenario-level guidance for how the selected role should speak.",
            zh: "可选的场景级配置，用于指导所选角色在本场景中的说话方式。",
          })}
        </Typography.Paragraph>
        <div className={styles.formGrid}>
          <Form.Item
            label={t({ en: "Tone style", zh: "语气风格" })}
            name="toneStylePresetId"
          >
            <Select
              allowClear
              optionFilterProp="label"
              options={getScenarioPresetOptions(
                scenarioPresets,
                "tone_style",
                locale,
              )}
              placeholder={t({
                en: "Use the model default",
                zh: "使用模型默认风格",
              })}
              showSearch
            />
          </Form.Item>
          <Form.Item
            label={t({
              en: "Interjection / challenge tendency",
              zh: "插话 / 挑战倾向",
            })}
            name={["voiceBehavior", "interruptFrequency"]}
          >
            <Select
              allowClear
              options={getInterruptFrequencyOptions(locale)}
              placeholder={t({ en: "Use the default", zh: "使用默认设置" })}
            />
          </Form.Item>
          <Form.Item
            label={t({ en: "Speaking pace", zh: "说话节奏" })}
            name={["voiceBehavior", "speakingPace"]}
          >
            <Select
              allowClear
              options={getSpeakingPaceOptions(locale)}
              placeholder={t({ en: "Use the default", zh: "使用默认设置" })}
            />
          </Form.Item>
        </div>

        <Divider titlePlacement="start">
          {t({ en: "Instructions check", zh: "提示词检查" })}
        </Divider>
        <PromptPreview
          lengthIssue={null}
          note={t({
            en: "This preview contains scenario Instructions only. The server combines it with the selected persona when a conversation starts.",
            zh: "此处只预览场景 Instructions；开始对话时，服务端才会与所选角色拼接。",
          })}
          prompt={preview}
        />
      </Form>
    </Drawer>
  );
}
