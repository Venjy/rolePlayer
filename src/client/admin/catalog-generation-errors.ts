import { CatalogApiError } from "../catalog/catalog-api";
import type { AppLocale } from "../i18n";
import { translate } from "../i18n/locale";

/** Converts provider-facing generation failures into localized UI messages. */
export function getCatalogGenerationErrorMessage(
  error: unknown,
  locale: AppLocale,
  subject: "persona" | "scenario",
): string {
  const noun =
    subject === "persona"
      ? { en: "persona", zh: "角色" }
      : { en: "scenario", zh: "场景" };
  if (error instanceof CatalogApiError) {
    const messages: Record<string, { en: string; zh: string }> = {
      catalog_generation_configuration_missing: {
        en: `Random ${noun.en} generation is unavailable because the text model is not configured.`,
        zh: `${noun.zh}随机生成暂不可用：文本模型尚未配置。`,
      },
      catalog_generation_model_timeout: {
        en: `Random ${noun.en} generation timed out. Please try again.`,
        zh: `${noun.zh}随机生成超时，请重试。`,
      },
      catalog_generation_model_unreachable: {
        en: `The text model could not be reached while generating the ${noun.en}.`,
        zh: `生成${noun.zh}时无法连接文本模型，请稍后重试。`,
      },
      catalog_generation_model_http_error: {
        en: `The text model rejected the ${noun.en} generation request.`,
        zh: `文本模型未能处理${noun.zh}生成请求，请稍后重试。`,
      },
      catalog_generation_model_invalid_response: {
        en: `The text model returned an unreadable ${noun.en} response.`,
        zh: `文本模型返回的${noun.zh}数据无法读取，请重试。`,
      },
      catalog_generation_invalid_output: {
        en: `The generated ${noun.en} did not satisfy the available options. Please try again.`,
        zh: `生成的${noun.zh}不符合当前可选项约束，请重试。`,
      },
    };
    const mapped = error.code ? messages[error.code] : undefined;
    if (mapped) return translate(locale, mapped);
  }
  return error instanceof Error
    ? error.message
    : translate(locale, {
        en: `Could not generate a random ${noun.en}. Please try again.`,
        zh: `随机生成${noun.zh}失败，请重试。`,
      });
}
