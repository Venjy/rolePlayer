import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Flex,
  Skeleton,
  Typography,
} from "antd";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ConversationFeedbackView } from "../../shared/conversation-feedback";
import type {
  ConversationDetail,
  ConversationDownloadFormat,
} from "../../shared/conversation-history";
import { useI18n } from "../i18n";
import { localizedText } from "../../shared/role-play-localization";
import {
  downloadConversation,
  fetchConversationFeedback,
  retryConversationFeedback,
} from "./conversation-api";
import {
  FeedbackReportContent,
  type HighlightedTranscriptMessage,
} from "./FeedbackReportContent";
import styles from "./ConversationFeedbackPage.module.css";

const POLL_INTERVAL_MS = 2_000;
const TRANSCRIPT_HIGHLIGHT_DURATION_MS = 2_800;

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

  const { conversation } = view;
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

  return (
    <main className={styles.page}>
      {renderHeader(`${scenarioName} · ${personaName}`)}
      <FeedbackReportContent
        conversationId={conversationId}
        view={view}
        retrying={retrying}
        downloading={downloading}
        deleting={deleting}
        tryingAgain={tryingAgain}
        highlightedMessage={highlightedMessage}
        onRetry={() => void retry()}
        onRevealTranscriptMessage={revealTranscriptMessage}
        onCopyTranscript={() => void copyTranscript()}
        onDownload={(format) => void download(format)}
        onTryAgain={() => void tryAgain(conversation)}
        onDelete={() => void deleteCurrentConversation()}
      />
    </main>
  );
}
