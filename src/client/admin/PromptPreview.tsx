import { Alert, Collapse, Space, Tag, Typography } from "antd";
import { MAX_REALTIME_INSTRUCTIONS_LENGTH } from "../../shared/realtime-protocol";
import type { RolePlayInstructionsLengthIssue } from "../../shared/role-play-instructions";
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
  const tooLong =
    lengthIssue !== null && lengthIssue !== undefined
      ? true
      : prompt.length > MAX_REALTIME_INSTRUCTIONS_LENGTH;
  const displayedLength = lengthIssue?.actualLength ?? prompt.length;

  return (
    <section aria-label="模型 Instructions 预览">
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
          title={`当前组合在 ${lengthIssue?.difficulty ?? "当前"} 难度下超出实时会话长度限制；保存关联配置会被拒绝。`}
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
                <span>模型 Instructions 预览</span>
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
