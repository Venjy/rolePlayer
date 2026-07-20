import { AimOutlined } from "@ant-design/icons";
import { Empty, Flex, Tag, Typography } from "antd";
import type {
  RefObject,
  ReactNode,
  UIEventHandler,
} from "react";
import type { SessionState } from "../../shared/realtime-protocol";
import { ConversationMessage } from "../components/ConversationMessage";
import { VoiceOrb } from "../components/VoiceOrb";
import { useI18n } from "../i18n";
import type { AssistantDraft, TranscriptTurn } from "./session-types";

interface FreeConversationPresentation {
  inputLevel: number;
  outputLevel: number;
  sessionState: SessionState;
  listening: boolean;
}

export interface ActiveSessionViewProps {
  header: ReactNode;
  composer: ReactNode;
  goals: string[];
  personaName: string;
  turns: TranscriptTurn[];
  userDraft: string;
  assistantDraft: AssistantDraft | null;
  gestureActive: boolean;
  freeConversation: FreeConversationPresentation | null;
  conversationViewportRef: RefObject<HTMLDivElement | null>;
  conversationEndRef: RefObject<HTMLDivElement | null>;
  onConversationScroll: UIEventHandler<HTMLElement>;
}

export function ActiveSessionView({
  header,
  composer,
  goals,
  personaName,
  turns,
  userDraft,
  assistantDraft,
  gestureActive,
  freeConversation,
  conversationViewportRef,
  conversationEndRef,
  onConversationScroll,
}: ActiveSessionViewProps) {
  const { t } = useI18n();

  return (
    <main className="chat-shell">
      {header}

      {goals.length > 0 && (
        <section
          className="chat-goals"
          aria-label={t({ en: "Goals", zh: "本次目标" })}
        >
          <Typography.Text className="chat-goals-label" type="secondary">
            <AimOutlined aria-hidden="true" />
            {t({ en: "Goals", zh: "本次目标" })}
          </Typography.Text>
          <Flex className="chat-goals-list" wrap gap={6}>
            {goals.map((goal, index) => (
              <Tag color="green" key={`${index}:${goal}`}>
                {goal}
              </Tag>
            ))}
          </Flex>
        </section>
      )}

      {freeConversation ? (
        <VoiceOrb
          inputLevel={freeConversation.inputLevel}
          outputLevel={freeConversation.outputLevel}
          sessionState={freeConversation.sessionState}
          listening={freeConversation.listening}
        />
      ) : (
        <section
          className="conversation-viewport"
          ref={conversationViewportRef}
          onScroll={onConversationScroll}
          role="log"
          aria-live="polite"
          aria-label={t({ en: "Conversation history", zh: "对话记录" })}
        >
          <div className="conversation-list">
            {turns.length === 0 && !userDraft && !assistantDraft && (
              <Empty
                className="empty-conversation"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  {
                    en: "Hold the button below and say your first sentence to {name}",
                    zh: "按住下方按钮，向 {name} 说出你的第一句话",
                  },
                  { name: personaName },
                )}
              />
            )}

            {turns.map((turn) => (
              <ConversationMessage
                key={turn.id}
                role={turn.role}
                text={turn.text}
                timestamp={turn.timestamp}
                interrupted={turn.interrupted}
                personaName={personaName}
              />
            ))}

            {userDraft && (
              <ConversationMessage
                role="user"
                text={userDraft}
                personaName={personaName}
                draft
              />
            )}

            {assistantDraft && (
              <ConversationMessage
                role="assistant"
                text={assistantDraft.text}
                personaName={personaName}
                draft
              />
            )}

            {gestureActive && (
              <div className="recording-overlay-spacer" aria-hidden="true" />
            )}
            <div ref={conversationEndRef} aria-hidden="true" />
          </div>
        </section>
      )}

      {composer}
    </main>
  );
}
