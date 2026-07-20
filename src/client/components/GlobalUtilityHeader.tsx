import {
  CustomerServiceOutlined,
  MoonOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Flex, Tooltip, Typography } from "antd";
import { LanguageToggleButton, useI18n } from "../i18n";

interface GlobalUtilityHeaderProps {
  adminVisible: boolean;
  busy: boolean;
  darkMode: boolean;
  onHome: () => void;
  onOpenAdmin: () => void;
  onToggleTheme: () => void;
}

export function GlobalUtilityHeader({
  adminVisible,
  busy,
  darkMode,
  onHome,
  onOpenAdmin,
  onToggleTheme,
}: GlobalUtilityHeaderProps) {
  const { t } = useI18n();
  const themeToggleLabel = darkMode
    ? t({ en: "Switch to light theme", zh: "切换到浅色主题" })
    : t({ en: "Switch to dark theme", zh: "切换到深色主题" });

  return (
    <header className="global-utility-header">
      <button
        type="button"
        className="global-brand"
        disabled={busy}
        aria-label={t({ en: "Return to home", zh: "返回首页" })}
        onClick={onHome}
      >
        <Avatar icon={<CustomerServiceOutlined />} />
        <div className="global-brand-copy">
          <Typography.Text strong>AI Role Player</Typography.Text>
          <Typography.Text className="global-brand-subtitle" type="secondary">
            {t({ en: "Sales practice training", zh: "销售实战训练" })}
          </Typography.Text>
        </div>
      </button>
      <Flex align="center" gap={4} className="global-utility-actions">
        {adminVisible && (
          <Button
            className="global-admin-button"
            disabled={busy}
            onClick={onOpenAdmin}
          >
            {t({ en: "Admin Console", zh: "管理控制台" })}
          </Button>
        )}
        <span className="global-language-toggle">
          <LanguageToggleButton />
        </span>
        <Tooltip title={themeToggleLabel}>
          <Button
            type="text"
            shape="circle"
            icon={darkMode ? <SunOutlined /> : <MoonOutlined />}
            aria-label={themeToggleLabel}
            onClick={onToggleTheme}
          />
        </Tooltip>
      </Flex>
    </header>
  );
}
