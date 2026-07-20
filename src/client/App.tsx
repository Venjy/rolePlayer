import {
  App as AntApp,
  ConfigProvider,
  Modal,
  theme as antdTheme,
  Typography,
} from "antd";
import { AppRouteContent } from "./app/AppRouteContent";
import { useRolePlayerAppController } from "./app/use-role-player-app-controller";
import { GlobalUtilityHeader } from "./components/GlobalUtilityHeader";

/** Root providers and rendering shell; behavior lives in focused controllers. */
export function App() {
  const controller = useRolePlayerAppController();

  return (
    <ConfigProvider
      locale={controller.antdLocale}
      theme={{
        algorithm: controller.isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#18a779",
          borderRadius: 12,
          fontFamily:
            'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }}
    >
      <AntApp className="application-root">
        {controller.messageContextHolder}
        <GlobalUtilityHeader {...controller.globalHeader} />
        <Modal
          open={controller.goalSuggestion.open}
          title={controller.goalSuggestion.title}
          okText={controller.goalSuggestion.okText}
          cancelText={controller.goalSuggestion.cancelText}
          okButtonProps={{ danger: true }}
          closable={false}
          maskClosable={false}
          onCancel={controller.goalSuggestion.onCancel}
          onOk={controller.goalSuggestion.onConfirm}
        >
          <Typography.Paragraph>
            {controller.goalSuggestion.description}
          </Typography.Paragraph>
        </Modal>
        <AppRouteContent {...controller.routeContent} />
      </AntApp>
    </ConfigProvider>
  );
}
