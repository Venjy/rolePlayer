import { Alert, Collapse, Space, Tag, Typography } from "antd";
import { MAX_REALTIME_INSTRUCTIONS_LENGTH } from "../../shared/realtime-protocol";
import type { RolePlayInstructionsLengthIssue } from "../../shared/role-play-instructions";
import { useI18n } from "../i18n";
import styles from "./AdminConsole.module.css";

interface PromptPreviewProps {
  prompt: string;
  note?: string;
  lengthIssue?: RolePlayInstructionsLengthIssue | null;
}

export function PromptPreview({
  prompt,
  note,
  lengthIssue,
}: PromptPreviewProps) {
  const { t } = useI18n();
  const tooLong =
    lengthIssue !== null && lengthIssue !== undefined
      ? true
      : prompt.length > MAX_REALTIME_INSTRUCTIONS_LENGTH;
  const displayedLength = lengthIssue?.actualLength ?? prompt.length;

  return (
    <section
      aria-label={t({
        en: "Model Instructions preview",
        zh: "模型 Instructions 预览",
      })}
    >
      {note ? (
        <Alert
          className={styles.previewNote}
          title={note}
          showIcon
          type="info"
        />
      ) : null}
      {tooLong ? (
        <Alert
          className={styles.previewNote}
          title={t(
            {
              en: "This combination exceeds the realtime session length limit at {difficulty} difficulty. Saving the association will be rejected.",
              zh: "当前组合在{difficulty}难度下超出实时会话长度限制；保存关联配置会被拒绝。",
            },
            {
              difficulty: lengthIssue?.difficulty
                ? t(
                    lengthIssue.difficulty === "easy"
                      ? { en: "easy", zh: "简单" }
                      : lengthIssue.difficulty === "medium"
                        ? { en: "medium", zh: "中等" }
                        : { en: "hard", zh: "困难" },
                  )
                : t({ en: "the current", zh: "当前" }),
            },
          )}
          showIcon
          type="error"
        />
      ) : null}
      <Collapse
        defaultActiveKey={["instructions"]}
        items={[
          {
            key: "instructions",
            label: (
              <Space size="small">
                <span>
                  {t({
                    en: "Model Instructions preview",
                    zh: "模型 Instructions 预览",
                  })}
                </span>
                <Tag color={tooLong ? "error" : "default"}>
                  {displayedLength}/{MAX_REALTIME_INSTRUCTIONS_LENGTH}
                </Tag>
              </Space>
            ),
            children: (
              <Typography.Paragraph
                className={styles.promptPreview}
                copyable={{ text: prompt }}
              >
                {prompt}
              </Typography.Paragraph>
            ),
          },
        ]}
        size="small"
      />
    </section>
  );
}
