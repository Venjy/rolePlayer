import {
  CustomerServiceOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Spin, Tag, Typography } from "antd";

export interface ConversationMessageProps {
  role: "user" | "assistant";
  text: string;
  timestamp?: Date;
  draft?: boolean;
  interrupted?: boolean;
  personaName?: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ConversationMessage({
  role,
  text,
  timestamp,
  draft = false,
  interrupted = false,
  personaName = "Alex",
}: ConversationMessageProps) {
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
      aria-label={isUser ? "你的消息" : `AI 客户 ${personaName} 的消息`}
    >
      {!isUser && avatar}
      <div className="message-content">
        <div className="message-bubble">
          {draft && !text ? (
            <span className="typing-indicator">
              <Spin size="small" />
              <Typography.Text type="secondary">正在组织回复</Typography.Text>
            </span>
          ) : (
            <Typography.Paragraph>{text}</Typography.Paragraph>
          )}
        </div>
        <div className="message-meta">
          <span>{isUser ? "你" : personaName}</span>
          {timestamp && <time>{formatTime(timestamp)}</time>}
          {draft && <span>{isUser ? "识别中" : "生成中"}</span>}
          {interrupted && (
            <Tag variant="filled" color="default">
              已打断
            </Tag>
          )}
        </div>
      </div>
      {isUser && avatar}
    </article>
  );
}
