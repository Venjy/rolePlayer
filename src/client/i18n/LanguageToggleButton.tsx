import { TranslationOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useI18n } from "./i18n-context";

export function LanguageToggleButton() {
  const { locale, t, toggleLocale } = useI18n();
  const accessibleLabel = t(
    locale === "en"
      ? { en: "Switch to Chinese", zh: "切换为中文" }
      : { en: "Switch to English", zh: "切换为英文" },
  );

  return (
    <Tooltip title={accessibleLabel}>
      <Button
        aria-label={accessibleLabel}
        icon={<TranslationOutlined />}
        onClick={toggleLocale}
      >
        {locale === "en" ? "中文" : "EN"}
      </Button>
    </Tooltip>
  );
}
