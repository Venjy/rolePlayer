import { HistoryOutlined } from "@ant-design/icons";
import { Button, Spin, Tooltip, Typography } from "antd";
import type { AppRoute } from "../routing/app-route";
import {
  AdminConsole,
  type AdminConsoleProps,
} from "../admin";
import {
  ConversationFeedbackPage,
  ConversationHistoryNavigation,
} from "../conversations";
import type { ConversationFeedbackPageProps } from "../conversations/ConversationFeedbackPage";
import type { ConversationHistoryNavigationProps } from "../conversations/ConversationHistoryNavigation";
import {
  LearnerLaunchPanel,
  type LearnerLaunchPanelProps,
} from "../learner";
import {
  ActiveSessionView,
  type ActiveSessionViewProps,
} from "../session/ActiveSessionView";
import {
  SessionHeader,
  type SessionHeaderProps,
} from "../session/SessionHeader";
import {
  VoiceComposer,
  type VoiceComposerProps,
} from "../session/VoiceComposer";
import { useI18n } from "../i18n";

export interface AppRouteContentProps {
  route: AppRoute;
  sessionActive: boolean;
  restoringConversationRoute: boolean;
  admin: AdminConsoleProps;
  history: ConversationHistoryNavigationProps;
  feedback: Omit<
    ConversationFeedbackPageProps,
    "conversationId" | "historyButton"
  >;
  launcher: Omit<LearnerLaunchPanelProps, "historyButton">;
  activeSession: Omit<ActiveSessionViewProps, "header" | "composer">;
  sessionHeader: SessionHeaderProps;
  voiceComposer: VoiceComposerProps;
  onOpenHistory: () => void;
}

function MobileHistoryButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const label = t({
    en: "Open conversation history",
    zh: "打开历史会话",
  });

  return (
    <Tooltip title={label}>
      <Button
        className="mobile-history-trigger"
        type="text"
        shape="circle"
        icon={<HistoryOutlined />}
        aria-label={label}
        onClick={onOpen}
      />
    </Tooltip>
  );
}

/**
 * Owns route-level rendering only. Realtime, audio, persistence, and
 * transition ordering remain in the controller and arrive as typed props.
 */
export function AppRouteContent({
  route,
  sessionActive,
  restoringConversationRoute,
  admin,
  history,
  feedback,
  launcher,
  activeSession,
  sessionHeader,
  voiceComposer,
  onOpenHistory,
}: AppRouteContentProps) {
  const { t } = useI18n();

  if (!sessionActive && route.page === "admin") {
    return (
      <div className="application-content">
        <AdminConsole {...admin} />
      </div>
    );
  }

  return (
    <div className="application-content">
      <div className="learner-workspace">
        <ConversationHistoryNavigation {...history} />
        <div
          className={`learner-workspace-main${sessionActive ? " has-active-session" : ""}`}
        >
          {!sessionActive && route.page === "feedback" ? (
            <ConversationFeedbackPage
              key={route.conversationId}
              conversationId={route.conversationId}
              historyButton={<MobileHistoryButton onOpen={onOpenHistory} />}
              {...feedback}
            />
          ) : restoringConversationRoute ? (
            <main className="route-loading-state" aria-busy="true">
              <Spin size="large" />
              <Typography.Text type="secondary">
                {t({
                  en: "Restoring conversation…",
                  zh: "正在恢复会话…",
                })}
              </Typography.Text>
            </main>
          ) : !sessionActive ? (
            <LearnerLaunchPanel
              {...launcher}
              historyButton={<MobileHistoryButton onOpen={onOpenHistory} />}
            />
          ) : (
            <ActiveSessionView
              {...activeSession}
              header={<SessionHeader {...sessionHeader} />}
              composer={<VoiceComposer {...voiceComposer} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}
