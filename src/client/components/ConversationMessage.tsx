import {
  CustomerServiceOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Spin, Tag, Typography } from "antd";
import { useI18n, type AppLocale } from "../i18n";

export interface ConversationMessageProps {
  role: "user" | "assistant";
  text: string;
  timestamp?: Date;
  draft?: boolean;
  interrupted?: boolean;
  personaName?: string;
}

function formatTime(date: Date, locale: AppLocale): string {
  return date.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConversationMessage({
  role,
  text,
  timestamp,
  draft = false,
  interrupted = false,
  personaName = "Alex",
}: ConversationMessageProps) {
  const { locale, t } = useI18n();
  const isUser = role === "user";
  const avatar = (
    <Avatar
      className="message-avatar"
      icon={isUser ? <UserOutlined /> : <CustomerServiceOutlined />}
      aria-hidden="true"
    />
  );

  return (
    <article
      className={`message-row message-row-${role}${draft ? " is-draft" : ""}`}
      aria-label={
        isUser
          ? t({ en: "Your message", zh: "你的消息" })
          : t(
              {
                en: "Message from AI customer {name}",
                zh: "AI 客户 {name} 的消息",
              },
              { name: personaName },
            )
      }
    >
      {!isUser && avatar}
      <div className="message-content">
        <div className="message-bubble">
          {draft && !text ? (
            <span className="typing-indicator">
              <Spin size="small" />
              <Typography.Text type="secondary">
                {t({ en: "Composing a reply", zh: "正在组织回复" })}
              </Typography.Text>
            </span>
          ) : (
            <Typography.Paragraph>{text}</Typography.Paragraph>
          )}
        </div>
        <div className="message-meta">
          <span>{isUser ? t({ en: "You", zh: "你" }) : personaName}</span>
          {timestamp && <time>{formatTime(timestamp, locale)}</time>}
          {draft && (
            <span>
              {isUser
                ? t({ en: "Transcribing", zh: "识别中" })
                : t({ en: "Generating", zh: "生成中" })}
            </span>
          )}
          {interrupted && (
            <Tag variant="filled" color="default">
              {t({ en: "Interrupted", zh: "已打断" })}
            </Tag>
          )}
        </div>
      </div>
      {isUser && avatar}
    </article>
  );
}
