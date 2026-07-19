import {
  HistoryOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Flex,
  List,
  Skeleton,
  Tag,
  Typography,
} from "antd";
import type { ConversationSummary } from "../../shared/conversation-history";
import type { Difficulty } from "../../shared/role-play-catalog";
import { useI18n, type LocalizedText } from "../i18n";
import styles from "./ConversationHistoryNavigation.module.css";

const DIFFICULTY_LABELS: Record<Difficulty, LocalizedText> = {
  easy: { en: "Easy", zh: "简单" },
  medium: { en: "Medium", zh: "中等" },
  hard: { en: "Hard", zh: "困难" },
};

export interface ConversationHistoryNavigationProps {
  conversations: readonly ConversationSummary[];
  activeConversationId: number | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onSelect: (id: number) => void | Promise<void>;
  onNew: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
}

function ConversationListContent({
  conversations,
  activeConversationId,
  loading,
  busy,
  error,
  onSelect,
  onNew,
  onRetry,
}: Omit<
  ConversationHistoryNavigationProps,
  "mobileOpen" | "onMobileClose"
>) {
  const { locale, t } = useI18n();
  const dateFormatter = new Intl.DateTimeFormat(
    locale === "zh" ? "zh-CN" : "en-US",
    {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  return (
    <div className={styles.content}>
      <div className={styles.heading}>
        <Flex align="center" gap={9}>
          <HistoryOutlined aria-hidden="true" />
          <Typography.Title level={4}>
            {t({ en: "Conversation history", zh: "历史会话" })}
          </Typography.Title>
        </Flex>
        <Typography.Text type="secondary">
          {t({
            en: "Continue any previous role-play",
            zh: "选择任意会话继续对练",
          })}
        </Typography.Text>
      </div>

      <Button
        block
        type="primary"
        icon={<PlusOutlined />}
        disabled={busy}
        onClick={() => void onNew()}
      >
        {t({ en: "New role-play", zh: "新建对练" })}
      </Button>

      {error && (
        <Alert
          type="error"
          showIcon
          title={t({
            en: "History could not be loaded",
            zh: "无法加载历史会话",
          })}
          description={error}
          action={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void onRetry()}
            >
              {t({ en: "Retry", zh: "重试" })}
            </Button>
          }
        />
      )}

      <div className={styles.listViewport} aria-busy={loading || busy}>
        {loading ? (
          <div className={styles.loadingList}>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton
                key={index}
                active
                avatar={false}
                title={{ width: "58%" }}
                paragraph={{ rows: 2, width: ["84%", "66%"] }}
              />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <Empty
            className={styles.empty}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t({
              en: "Your completed turns will appear here",
              zh: "完成对话后，会话会显示在这里",
            })}
          />
        ) : (
          <List
            split={false}
            dataSource={[...conversations]}
            renderItem={(conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <List.Item className={styles.listItem}>
                  <Button
                    type="text"
                    className={styles.conversationButton}
                    data-active={active}
                    aria-current={active ? "page" : undefined}
                    disabled={busy}
                    onClick={() => void onSelect(conversation.id)}
                  >
                    <span className={styles.itemTopline}>
                      <span className={styles.personaName}>
                        <MessageOutlined aria-hidden="true" />
                        <span>{conversation.personaName}</span>
                      </span>
                      <span className={styles.date}>
                        {dateFormatter.format(new Date(conversation.updatedAt))}
                      </span>
                    </span>
                    <span className={styles.scenarioLine}>
                      <span>{conversation.scenarioName}</span>
                      <Tag bordered={false}>
                        {t(DIFFICULTY_LABELS[conversation.difficulty])}
                      </Tag>
                    </span>
                    <span className={styles.preview}>
                      {conversation.lastMessagePreview ??
                        t({ en: "No messages yet", zh: "还没有消息" })}
                    </span>
                  </Button>
                </List.Item>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

export function ConversationHistoryNavigation(
  props: ConversationHistoryNavigationProps,
) {
  const { t } = useI18n();
  const contentProps = {
    conversations: props.conversations,
    activeConversationId: props.activeConversationId,
    loading: props.loading,
    busy: props.busy,
    error: props.error,
    onSelect: props.onSelect,
    onNew: props.onNew,
    onRetry: props.onRetry,
  };

  return (
    <>
      <aside
        className={styles.desktopNavigation}
        aria-label={t({ en: "Conversation history", zh: "历史会话" })}
      >
        <ConversationListContent {...contentProps} />
      </aside>
      <Drawer
        className={styles.mobileDrawer}
        placement="left"
        size="min(88vw, 360px)"
        title={t({ en: "Conversation history", zh: "历史会话" })}
        open={props.mobileOpen}
        onClose={props.onMobileClose}
        destroyOnHidden
      >
        <ConversationListContent {...contentProps} />
      </Drawer>
    </>
  );
}
