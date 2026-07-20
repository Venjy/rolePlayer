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
  App as AntApp,
  Button,
  Card,
  Divider,
  Dropdown,
  Empty,
  Flex,
  List,
  Popconfirm,
  Progress,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ConversationFeedbackView } from "../../shared/conversation-feedback";
import type {
  ConversationDetail,
  ConversationDownloadFormat,
} from "../../shared/conversation-history";
import { ConversationMessage } from "../components/ConversationMessage";
import { useI18n } from "../i18n";
import { localizedText } from "../../shared/role-play-localization";
import {
  downloadConversation,
  fetchConversationFeedback,
  retryConversationFeedback,
} from "./conversation-api";
import styles from "./ConversationFeedbackPage.module.css";

const POLL_INTERVAL_MS = 2_000;
const TRANSCRIPT_HIGHLIGHT_DURATION_MS = 2_800;

interface HighlightedTranscriptMessage {
  conversationId: number;
  messageId: number;
  sequence: number;
}

export interface ConversationFeedbackPageProps {
  conversationId: number;
  historyButton: ReactNode;
  onFeedbackSettled: () => void | Promise<void>;
  onDeleteConversation: (conversationId: number) => Promise<void>;
  onTryAgain: (conversation: ConversationDetail) => Promise<void>;
}

export function ConversationFeedbackPage({
  conversationId,
  historyButton,
  onFeedbackSettled,
  onDeleteConversation,
  onTryAgain,
}: ConversationFeedbackPageProps) {
  const { message } = AntApp.useApp();
  const { locale, t } = useI18n();
  const [view, setView] = useState<ConversationFeedbackView | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tryingAgain, setTryingAgain] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlightedMessage, setHighlightedMessage] = useState<HighlightedTranscriptMessage | null>(null);
  const highlightSequenceRef = useRef(0);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
  }, [conversationId]);

  const revealTranscriptMessage = useCallback((messageId: number) => {
    const target = document.getElementById(`feedback-message-${messageId}`);
    if (!target) return;

    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }

    const nextHighlight = {
      conversationId,
      messageId,
      sequence: highlightSequenceRef.current + 1,
    };
    highlightSequenceRef.current = nextHighlight.sequence;
    setHighlightedMessage(nextHighlight);
    target.scrollIntoView({ behavior: "smooth", block: "center" });

    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessage((current) => (
        current?.sequence === nextHighlight.sequence ? null : current
      ));
      highlightTimerRef.current = null;
    }, TRANSCRIPT_HIGHLIGHT_DURATION_MS);
  }, [conversationId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchConversationFeedback(conversationId, signal);
      setView(next);
      setLoadError(null);
      if (next.feedback.status === "completed" || next.feedback.status === "failed") {
        void onFeedbackSettled();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [conversationId, onFeedbackSettled]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchConversationFeedback(conversationId, controller.signal)
      .then((next) => {
        setView(next);
        setLoadError(null);
        if (next.feedback.status === "completed" || next.feedback.status === "failed") {
          void onFeedbackSettled();
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [conversationId, onFeedbackSettled]);

  useEffect(() => {
    if (view?.feedback.status !== "pending" && view?.feedback.status !== "processing") {
      return;
    }
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      await load(controller.signal);
      if (!controller.signal.aborted) {
        timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };
    timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [load, view?.feedback.status]);

  const durationSeconds = useMemo(() => {
    if (!view) return 0;
    return Math.max(0, Math.round(view.conversation.activeDurationMs / 1_000));
  }, [view]);

  const renderHeader = (subtitle?: string) => (
    <header className={styles.header}>
      <Flex align="center" gap={8}>
        {historyButton}
        <div>
          <Typography.Title level={2}>
            {t({ en: "Role-play feedback", zh: "对练复盘" })}
          </Typography.Title>
          {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
        </div>
      </Flex>
    </header>
  );

  const retry = async () => {
    setRetrying(true);
    try {
      setView(await retryConversationFeedback(conversationId));
      setLoadError(null);
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : String(error),
        5,
      );
    } finally {
      setRetrying(false);
    }
  };

  const download = async (format: ConversationDownloadFormat) => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadConversation(conversationId, format);
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : String(error),
        5,
      );
    } finally {
      setDownloading(false);
    }
  };

  const copyTranscript = async () => {
    if (!view) return;
    const personaName = localizedText(
      view.conversation.persona.name,
      view.conversation.persona.nameZhCn,
      locale,
    );
    const transcript = view.conversation.messages
      .map((item) => {
        const speaker = item.role === "user"
          ? t({ en: "You", zh: "你" })
          : personaName;
        return `${speaker}: ${item.text}`;
      })
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(transcript);
      void message.success(t({ en: "Transcript copied", zh: "对话文字已复制" }));
    } catch {
      void message.error(t({ en: "Could not copy the transcript", zh: "无法复制对话文字" }), 5);
    }
  };

  const deleteCurrentConversation = async () => {
    setDeleting(true);
    try {
      await onDeleteConversation(conversationId);
      void message.success(t({
        en: "Role-play record deleted",
        zh: "本次对练记录已删除",
      }));
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : String(error),
        5,
      );
    } finally {
      setDeleting(false);
    }
  };

  const tryAgain = async (conversation: ConversationDetail) => {
    setTryingAgain(true);
    try {
      await onTryAgain(conversation);
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : String(error),
        5,
      );
    } finally {
      setTryingAgain(false);
    }
  };

  if (loading && !view) {
    return (
      <main className={styles.page} aria-busy="true">
        {renderHeader()}
        <Skeleton active paragraph={{ rows: 12 }} />
      </main>
    );
  }

  if (!view) {
    return (
      <main className={styles.page}>
        {renderHeader()}
        <Alert
          type="error"
          showIcon
          title={t({ en: "Feedback could not be loaded", zh: "无法加载复盘" })}
          description={loadError}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              {t({ en: "Retry", zh: "重试" })}
            </Button>
          }
        />
      </main>
    );
  }

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
  const userTurns = conversation.messages.filter(({ role }) => role === "user").length;
  const feedbackPending = feedback.status === "pending" || feedback.status === "processing";
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
      { key: "text", label: t({ en: "Transcript (.txt)", zh: "文字（.txt）" }) },
      {
        key: "both",
        label: t({ en: "Audio and transcript (.zip)", zh: "音频和文字（.zip）" }),
        disabled: !audioAvailable,
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "audio" || key === "text" || key === "both") void download(key);
    },
  };

  return (
    <main className={styles.page}>
      {renderHeader(`${scenarioName} · ${personaName}`)}

      <section className={styles.content}>
        <Card className={styles.summaryCard}>
          <div className={styles.scoreArea}>
            {feedback.overallScore === null ? (
              <Progress type="circle" percent={0} status="active" format={() => "—"} />
            ) : (
              <Progress type="circle" percent={feedback.overallScore} format={(score) => `${score}`} />
            )}
            <Typography.Text type="secondary">
              {t({ en: "Overall score", zh: "综合得分" })}
            </Typography.Text>
          </div>
          <div className={styles.assessment}>
            <Typography.Title level={3}>
              {t({ en: "Overall assessment", zh: "整体评价" })}
            </Typography.Title>
            {feedbackPending ? (
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            ) : feedback.status === "failed" ? (
              <Alert
                type="warning"
                showIcon
                title={failurePresentation.title}
                description={(
                  <Space direction="vertical" size={2}>
                    <Typography.Text>{failurePresentation.description}</Typography.Text>
                    {failurePresentation.technicalDetail && (
                      <Typography.Text type="secondary">
                        {t({ en: "Technical detail: ", zh: "技术详情：" })}
                        {failurePresentation.technicalDetail}
                      </Typography.Text>
                    )}
                  </Space>
                )}
                action={failurePresentation.retryable
                  ? (
                      <Button loading={retrying} icon={<ReloadOutlined />} onClick={() => void retry()}>
                        {t({ en: "Retry", zh: "重试" })}
                      </Button>
                    )
                  : (
                      undefined
                    )}
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
          <Statistic title={t({ en: "Scenario", zh: "场景" })} value={scenarioName} />
          <Statistic title={t({ en: "Role", zh: "角色" })} value={personaName} />
          <Statistic title={t({ en: "Duration", zh: "时长" })} value={formatDuration(durationSeconds, locale)} />
          <Statistic title={t({ en: "Your turns", zh: "你的轮次" })} value={userTurns} />
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
                        avatar={<CheckCircleOutlined className={styles.strengthIcon} />}
                        description={localizedText(item.text, item.textZhCn, locale)}
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
                        avatar={<WarningOutlined className={styles.improvementIcon} />}
                        description={localizedText(item.text, item.textZhCn, locale)}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </div>

            <Card title={t({ en: "Score breakdown", zh: "评分明细" })}>
              <div className={styles.criteriaGrid}>
                {feedback.criterionScores.map((criterion) => (
                  <div key={criterion.criterionPosition} className={styles.criterion}>
                    <Flex justify="space-between" align="center" gap={12}>
                      <Typography.Text strong>
                        {localizedText(criterion.name, criterion.nameZhCn, locale)}
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

            <Card title={t({ en: "Actionable coaching tips", zh: "可执行的改进建议" })}>
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

            {feedback.moments.length > 0 && (
              <Card title={t({ en: "Highlighted moments", zh: "关键时刻" })}>
                <div className={styles.momentsGrid}>
                  {feedback.moments.map((moment) => (
                  <button
                    key={moment.position}
                    type="button"
                    className={styles.moment}
                    onClick={() => revealTranscriptMessage(moment.messageId)}
                  >
                    <Tag color={moment.kind === "strength" ? "success" : "warning"}>
                      {moment.kind === "strength"
                        ? t({ en: "Strong moment", zh: "亮点" })
                        : t({ en: "Could improve", zh: "可改进" })}
                    </Tag>
                    <Typography.Text strong>
                      {localizedText(moment.title, moment.titleZhCn, locale)}
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
                      <Typography.Text className={styles.momentText} type="secondary">
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
              </Card>
            )}
          </>
        )}

        <Card
          title={t({ en: "Transcript", zh: "对话记录" })}
          extra={
            <Flex gap={8} wrap>
              <Button icon={<CopyOutlined />} onClick={() => void copyTranscript()}>
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
                    highlightedMessage?.conversationId === conversationId
                      && highlightedMessage.messageId === item.id
                      ? ` ${highlightedMessage.sequence % 2 === 0
                          ? styles.transcriptMessageHighlightEven
                          : styles.transcriptMessageHighlightOdd}`
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
            onClick={() => void tryAgain(conversation)}
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
            onConfirm={() => deleteCurrentConversation()}
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
    </main>
  );
}

function formatDuration(seconds: number, locale: "en" | "zh"): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (locale === "zh") return `${minutes} 分 ${remainder} 秒`;
  return `${minutes}m ${remainder}s`;
}

interface FeedbackFailurePresentation {
  title: string;
  description: string;
  retryable: boolean;
  technicalDetail?: string;
}

function getFeedbackFailurePresentation(
  errorCode: string | null,
  errorMessage: string | null,
  locale: "en" | "zh",
  userTurns: number,
): FeedbackFailurePresentation {
  const localized = (en: string, zh: string) => locale === "zh" ? zh : en;
  const withTechnicalDetail = (
    value: Omit<FeedbackFailurePresentation, "technicalDetail">,
  ): FeedbackFailurePresentation => ({
    ...value,
    ...(errorMessage ? { technicalDetail: errorMessage } : {}),
  });

  switch (errorCode) {
    case "feedback_configuration_missing":
      return withTechnicalDetail({
        title: localized("Feedback model is not configured", "复盘模型尚未配置"),
        description: localized(
          "Configure the feedback-model server environment variables, restart the server, and retry.",
          "请配置复盘模型所需的服务端环境变量，重启服务后再重试。",
        ),
        retryable: true,
      });
    case "feedback_insufficient_conversation":
      return withTechnicalDetail({
        title: localized("Not enough conversation content", "对话内容不足"),
        description: localized(
          "No finalized learner speech was saved, so there is no evidence from which to generate feedback.",
          "本次会话没有保存任何有效的学员发言，因此没有可用于复盘的对话证据。",
        ),
        retryable: false,
      });
    case "feedback_data_unavailable":
      return withTechnicalDetail({
        title: localized("Conversation data could not be loaded", "无法读取对话数据"),
        description: localized(
          "Feedback stopped while loading the transcript, scenario, or scoring criteria. Check the conversation database and retry.",
          "复盘在读取对话、场景或评分标准时中止，请检查会话数据库后重试。",
        ),
        retryable: true,
      });
    case "feedback_model_timeout":
      return withTechnicalDetail({
        title: localized("Feedback model timed out", "复盘模型响应超时"),
        description: localized(
          "The model did not respond within the configured time. Check service latency or increase the timeout, then retry.",
          "模型未在设定时间内响应，请检查服务延迟或适当增加超时时间后重试。",
        ),
        retryable: true,
      });
    case "feedback_model_unreachable":
      return withTechnicalDetail({
        title: localized("Could not reach the feedback model", "无法连接复盘模型"),
        description: localized(
          "The request failed before a model response was received. Check DNS, network access, proxy settings, and the configured endpoint.",
          "请求在收到模型响应前失败，请检查 DNS、网络、代理设置以及模型接口地址。",
        ),
        retryable: true,
      });
    case "feedback_model_http_error":
      return withTechnicalDetail({
        title: localized("Feedback service rejected the request", "复盘服务拒绝了请求"),
        description: localized(
          "The provider returned an HTTP error. Check the status below, API credentials, quota, and provider availability before retrying.",
          "模型服务返回了 HTTP 错误，请根据下方状态检查 API 凭证、额度和服务可用性后重试。",
        ),
        retryable: true,
      });
    case "feedback_model_invalid_response":
      return withTechnicalDetail({
        title: localized("Feedback service response was invalid", "复盘服务响应格式异常"),
        description: localized(
          "The provider was reachable, but its API response did not contain a usable completion. Verify endpoint and model compatibility, then retry.",
          "已连接到模型服务，但其 API 响应中没有可用的生成结果，请检查接口地址及模型兼容性后重试。",
        ),
        retryable: true,
      });
    case "feedback_persistence_failed":
      return withTechnicalDetail({
        title: localized("Feedback could not be saved", "复盘结果保存失败"),
        description: localized(
          "The model generated a report, but writing it to the conversation database failed. Check database access and storage space, then retry.",
          "模型已经生成复盘，但写入会话数据库时失败，请检查数据库访问权限和磁盘空间后重试。",
        ),
        retryable: true,
      });
    case "feedback_invalid_output": {
      const legacyShortConversationFailure = userTurns > 0
        && userTurns < 3
        && /moments|highlight/i.test(errorMessage ?? "");
      return withTechnicalDetail({
        title: legacyShortConversationFailure
          ? localized(
              "A legacy short-conversation rule rejected this report",
              "旧版短对话规则拒绝了本次复盘",
            )
          : localized(
              "Generated feedback failed validation",
              "生成的复盘内容校验失败",
            ),
        description: legacyShortConversationFailure
          ? localized(
              `This session has only ${userTurns} learner turn(s), but the old report format required at least three highlights. The rule has been relaxed; retry to regenerate the report.`,
              `本次会话只有 ${userTurns} 轮学员发言，而旧版格式强制要求至少 3 个关键时刻。该规则现已放宽，请重试生成。`,
            )
          : localized(
              "The model responded, but required core fields or criterion references were still invalid after automatic retries. Retry to request a fresh report.",
              "模型已经返回内容，但核心字段或评分标准引用在自动重试后仍未通过校验，请重试生成一份新复盘。",
            ),
        retryable: true,
      });
    }
    case "feedback_generation_failed":
      return withTechnicalDetail({
        title: localized("Feedback generation failed", "复盘生成发生未知错误"),
        description: localized(
          "An uncategorized error interrupted feedback generation. Use the technical detail below to locate the failing step, then retry.",
          "复盘生成被一个尚未分类的错误中止，请根据下方技术详情定位问题后重试。",
        ),
        retryable: true,
      });
    default:
      return withTechnicalDetail({
        title: localized("Feedback generation failed", "复盘生成失败"),
        description: localized(
          "The server reported an unknown feedback error. Review the technical detail and server logs before retrying.",
          "服务端返回了未知的复盘错误，请查看技术详情和服务端日志后重试。",
        ),
        retryable: true,
      });
  }
}
