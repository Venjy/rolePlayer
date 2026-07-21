import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  RedoOutlined,
  ReloadOutlined,
  RiseOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Divider,
  Dropdown,
  Empty,
  Flex,
  List,
  Popconfirm,
  Progress,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import {
  MIN_FEEDBACK_MOMENT_COUNT,
  type ConversationFeedbackView,
} from "../../shared/conversation-feedback";
import type { ConversationDownloadFormat } from "../../shared/conversation-history";
import { localizedText } from "../../shared/role-play-localization";
import { ConversationMessage } from "../components/ConversationMessage";
import { useI18n } from "../i18n";
import {
  formatFeedbackDuration,
  getFeedbackFailurePresentation,
} from "./feedback-presentation";
import styles from "./ConversationFeedbackPage.module.css";

export interface HighlightedTranscriptMessage {
  conversationId: number;
  messageId: number;
  sequence: number;
}

interface FeedbackReportContentProps {
  conversationId: number;
  view: ConversationFeedbackView;
  retrying: boolean;
  downloading: boolean;
  deleting: boolean;
  tryingAgain: boolean;
  highlightedMessage: HighlightedTranscriptMessage | null;
  onRetry: () => void;
  onRevealTranscriptMessage: (messageId: number) => void;
  onCopyTranscript: () => void;
  onDownload: (format: ConversationDownloadFormat) => void;
  onTryAgain: () => void;
  onDelete: () => void;
}

export function FeedbackReportContent({
  conversationId,
  view,
  retrying,
  downloading,
  deleting,
  tryingAgain,
  highlightedMessage,
  onRetry,
  onRevealTranscriptMessage,
  onCopyTranscript,
  onDownload,
  onTryAgain,
  onDelete,
}: FeedbackReportContentProps) {
  const { locale, t } = useI18n();
  const { conversation, feedback } = view;
  const personaName = localizedText(
    conversation.persona.name,
    conversation.persona.nameZhCn,
    locale,
  );
  const scenarioName = localizedText(
    conversation.scenario.name,
    conversation.scenario.nameZhCn,
    locale,
  );
  const durationSeconds = Math.max(
    0,
    Math.round(conversation.activeDurationMs / 1_000),
  );
  const userTurns = conversation.messages.filter(
    ({ role }) => role === "user",
  ).length;
  const conversationTooShortForMinimumMoments =
    userTurns < MIN_FEEDBACK_MOMENT_COUNT;
  const audioAvailable = conversation.audioAvailable;
  const failurePresentation = getFeedbackFailurePresentation(
    feedback.errorCode,
    feedback.errorMessage,
    locale,
    userTurns,
  );
  const downloadMenu = {
    items: [
      {
        key: "audio",
        label: t({ en: "Audio (.mp3)", zh: "音频（.mp3）" }),
        disabled: !audioAvailable,
      },
      {
        key: "text",
        label: t({ en: "Transcript (.txt)", zh: "文字（.txt）" }),
      },
      {
        key: "both",
        label: t({
          en: "Audio and transcript (.zip)",
          zh: "音频和文字（.zip）",
        }),
        disabled: !audioAvailable,
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "audio" || key === "text" || key === "both") {
        onDownload(key);
      }
    },
  };

  return (
    <section className={styles.content}>
      <Card
        className={`${styles.summaryCard} ${
          feedback.overallScore === null ? styles.summaryCardWithoutScore : ""
        }`}
      >
        {feedback.overallScore !== null && (
          <div className={styles.scoreArea}>
            <Progress
              type="circle"
              percent={feedback.overallScore}
              format={(score) => `${score}`}
            />
            <Typography.Text type="secondary">
              {t({ en: "Overall score", zh: "综合得分" })}
            </Typography.Text>
          </div>
        )}
        <div className={styles.assessment}>
          <Typography.Title level={3}>
            {t({ en: "Overall assessment", zh: "整体评价" })}
          </Typography.Title>
          {feedback.status === "failed" ? (
            <Alert
              type="warning"
              showIcon
              title={failurePresentation.title}
              description={
                <Space direction="vertical" size={2}>
                  <Typography.Text>
                    {failurePresentation.description}
                  </Typography.Text>
                  {failurePresentation.technicalDetail && (
                    <Typography.Text type="secondary">
                      {t({ en: "Technical detail: ", zh: "技术详情：" })}
                      {failurePresentation.technicalDetail}
                    </Typography.Text>
                  )}
                </Space>
              }
              action={
                failurePresentation.retryable ? (
                  <Button
                    loading={retrying}
                    icon={<ReloadOutlined />}
                    onClick={onRetry}
                  >
                    {t({ en: "Retry", zh: "重试" })}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Typography.Paragraph>
              {localizedText(
                feedback.overallAssessment ?? "",
                feedback.overallAssessmentZhCn ?? "",
                locale,
              )}
            </Typography.Paragraph>
          )}
        </div>
      </Card>

      <div className={styles.metadataGrid}>
        <Statistic
          title={t({ en: "Scenario", zh: "场景" })}
          value={scenarioName}
        />
        <Statistic
          title={t({ en: "Role", zh: "角色" })}
          value={personaName}
        />
        <Statistic
          title={t({ en: "Duration", zh: "时长" })}
          value={formatFeedbackDuration(durationSeconds, locale)}
        />
        <Statistic
          title={t({ en: "Your turns", zh: "你的轮次" })}
          value={userTurns}
        />
      </div>

      {feedback.status === "completed" && (
        <>
          <div className={styles.twoColumn}>
            <Card title={t({ en: "Strengths", zh: "做得好的地方" })}>
              <List
                dataSource={feedback.strengths}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <CheckCircleOutlined className={styles.strengthIcon} />
                      }
                      description={localizedText(
                        item.text,
                        item.textZhCn,
                        locale,
                      )}
                    />
                  </List.Item>
                )}
              />
            </Card>
            <Card title={t({ en: "Areas to improve", zh: "需要改进的地方" })}>
              <List
                dataSource={feedback.improvementAreas}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <WarningOutlined className={styles.improvementIcon} />
                      }
                      description={localizedText(
                        item.text,
                        item.textZhCn,
                        locale,
                      )}
                    />
                  </List.Item>
                )}
              />
            </Card>
          </div>

          {feedback.criterionScores.length > 0 && (
            <Card title={t({ en: "Score breakdown", zh: "评分明细" })}>
              <div className={styles.criteriaGrid}>
                {feedback.criterionScores.map((criterion) => (
                  <div
                    key={criterion.criterionPosition}
                    className={styles.criterion}
                  >
                    <Flex justify="space-between" align="center" gap={12}>
                      <Typography.Text strong>
                        {localizedText(
                          criterion.name,
                          criterion.nameZhCn,
                          locale,
                        )}
                      </Typography.Text>
                      <Tag>{criterion.weight}%</Tag>
                    </Flex>
                    <Progress percent={criterion.score} />
                    <Typography.Paragraph type="secondary">
                      {localizedText(
                        criterion.rationale,
                        criterion.rationaleZhCn,
                        locale,
                      )}
                    </Typography.Paragraph>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card
            title={t({
              en: "Actionable coaching tips",
              zh: "可执行的改进建议",
            })}
          >
            <List
              grid={{ gutter: 16, xs: 1, md: 2 }}
              dataSource={feedback.coachingTips}
              renderItem={(tip) => (
                <List.Item>
                  <Card size="small" className={styles.tipCard}>
                    <Space align="start">
                      <RiseOutlined className={styles.strengthIcon} />
                      <div>
                        <Typography.Text strong>
                          {localizedText(tip.title, tip.titleZhCn, locale)}
                        </Typography.Text>
                        <Typography.Paragraph>
                          {localizedText(tip.advice, tip.adviceZhCn, locale)}
                        </Typography.Paragraph>
                      </div>
                    </Space>
                  </Card>
                </List.Item>
              )}
            />
          </Card>

          {(feedback.moments.length > 0 ||
            conversationTooShortForMinimumMoments) && (
            <Card title={t({ en: "Highlighted moments", zh: "关键时刻" })}>
              <Flex vertical gap={16}>
                {conversationTooShortForMinimumMoments && (
                  <Alert
                    type="warning"
                    showIcon
                    title={t({
                      en: `This conversation has only ${userTurns} valid ${userTurns === 1 ? "learner turn" : "learner turns"}. There is too little evidence to generate a sufficient number of highlighted moments.`,
                      zh: `本次对话只有 ${userTurns} 轮有效学员发言，对话证据太少，无法生成足量的关键时刻。`,
                    })}
                  />
                )}
                {feedback.moments.length > 0 && (
                  <div className={styles.momentsGrid}>
                    {feedback.moments.map((moment) => (
                      <button
                        key={moment.position}
                        type="button"
                        className={styles.moment}
                        onClick={() =>
                          onRevealTranscriptMessage(moment.messageId)
                        }
                      >
                        <Tag
                          color={
                            moment.kind === "strength" ? "success" : "warning"
                          }
                        >
                          {moment.kind === "strength"
                            ? t({ en: "Strong moment", zh: "亮点" })
                            : t({ en: "Could improve", zh: "可改进" })}
                        </Tag>
                        <Typography.Text strong>
                          {localizedText(
                            moment.title,
                            moment.titleZhCn,
                            locale,
                          )}
                        </Typography.Text>
                        <Typography.Text className={styles.momentText}>
                          {localizedText(
                            moment.assessment,
                            moment.assessmentZhCn,
                            locale,
                          )}
                        </Typography.Text>
                        {localizedText(
                          moment.suggestedApproach,
                          moment.suggestedApproachZhCn,
                          locale,
                        ) && (
                          <Typography.Text
                            className={styles.momentText}
                            type="secondary"
                          >
                            {t({ en: "Try: ", zh: "可以这样做：" })}
                            {localizedText(
                              moment.suggestedApproach,
                              moment.suggestedApproachZhCn,
                              locale,
                            )}
                          </Typography.Text>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </Flex>
            </Card>
          )}
        </>
      )}

      <Card
        title={t({ en: "Transcript", zh: "对话记录" })}
        extra={
          <Flex gap={8} wrap>
            <Button icon={<CopyOutlined />} onClick={onCopyTranscript}>
              {t({ en: "Copy", zh: "复制" })}
            </Button>
            <Dropdown menu={downloadMenu} disabled={downloading}>
              <Button loading={downloading} icon={<DownloadOutlined />}>
                {t({ en: "Download", zh: "下载" })}
              </Button>
            </Dropdown>
          </Flex>
        }
      >
        {conversation.messages.length === 0 ? (
          <Empty description={t({ en: "No transcript", zh: "暂无对话文字" })} />
        ) : (
          <div className={styles.transcript}>
            {conversation.messages.map((item) => (
              <div
                key={item.id}
                id={`feedback-message-${item.id}`}
                className={`${styles.transcriptMessage}${
                  highlightedMessage?.conversationId === conversationId &&
                  highlightedMessage.messageId === item.id
                    ? ` ${
                        highlightedMessage.sequence % 2 === 0
                          ? styles.transcriptMessageHighlightEven
                          : styles.transcriptMessageHighlightOdd
                      }`
                    : ""
                }`}
              >
                <ConversationMessage
                  role={item.role}
                  text={item.text}
                  timestamp={new Date(item.createdAt)}
                  interrupted={item.interrupted}
                  personaName={personaName}
                />
              </div>
            ))}
          </div>
        )}
        {!audioAvailable && conversation.messageCount > 0 && (
          <>
            <Divider />
            <Typography.Text type="secondary">
              {t({
                en: "Audio export is unavailable because one or more messages have no saved audio.",
                zh: "由于一条或多条消息没有保存音频，因此无法导出完整音频。",
              })}
            </Typography.Text>
          </>
        )}
      </Card>

      <Flex
        className={styles.bottomActions}
        align="center"
        justify="space-between"
        gap={12}
        wrap
      >
        <Button
          type="primary"
          icon={<RedoOutlined />}
          loading={tryingAgain}
          disabled={deleting}
          onClick={onTryAgain}
        >
          {t({ en: "Try again", zh: "再试一次" })}
        </Button>
        <Popconfirm
          title={t({
            en: "Delete this role-play record?",
            zh: "删除本次对练记录？",
          })}
          description={t({
            en: "The transcript, audio, and feedback will be permanently deleted. This action cannot be undone.",
            zh: "对话文字、音频和复盘都会被永久删除，此操作无法撤销。",
          })}
          okText={t({ en: "Delete", zh: "删除" })}
          cancelText={t({ en: "Cancel", zh: "取消" })}
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
        >
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={deleting}
            disabled={tryingAgain}
          >
            {t({
              en: "Delete this role-play record",
              zh: "删除本次对练记录",
            })}
          </Button>
        </Popconfirm>
      </Flex>
    </section>
  );
}
