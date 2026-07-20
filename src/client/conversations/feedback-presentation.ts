export function formatFeedbackDuration(
  seconds: number,
  locale: "en" | "zh",
): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (locale === "zh") return `${minutes} 分 ${remainder} 秒`;
  return `${minutes}m ${remainder}s`;
}

export interface FeedbackFailurePresentation {
  title: string;
  description: string;
  retryable: boolean;
  technicalDetail?: string;
}

export function getFeedbackFailurePresentation(
  errorCode: string | null,
  errorMessage: string | null,
  locale: "en" | "zh",
  userTurns: number,
): FeedbackFailurePresentation {
  const localized = (en: string, zh: string) => (locale === "zh" ? zh : en);
  const withTechnicalDetail = (
    value: Omit<FeedbackFailurePresentation, "technicalDetail">,
  ): FeedbackFailurePresentation => ({
    ...value,
    ...(errorMessage ? { technicalDetail: errorMessage } : {}),
  });

  switch (errorCode) {
    case "feedback_configuration_missing":
      return withTechnicalDetail({
        title: localized("Feedback model is not configured", "复盘模型尚未配置"),
        description: localized(
          "Configure the feedback-model server environment variables, restart the server, and retry.",
          "请配置复盘模型所需的服务端环境变量，重启服务后再重试。",
        ),
        retryable: true,
      });
    case "feedback_insufficient_conversation":
      return withTechnicalDetail({
        title: localized("Not enough conversation content", "对话内容不足"),
        description: localized(
          "No finalized learner speech was saved, so there is no evidence from which to generate feedback.",
          "本次会话没有保存任何有效的学员发言，因此没有可用于复盘的对话证据。",
        ),
        retryable: false,
      });
    case "feedback_data_unavailable":
      return withTechnicalDetail({
        title: localized("Conversation data could not be loaded", "无法读取对话数据"),
        description: localized(
          "Feedback stopped while loading the transcript, scenario, or scoring criteria. Check the conversation database and retry.",
          "复盘在读取对话、场景或评分标准时中止，请检查会话数据库后重试。",
        ),
        retryable: true,
      });
    case "feedback_model_timeout":
      return withTechnicalDetail({
        title: localized("Feedback model timed out", "复盘模型响应超时"),
        description: localized(
          "The model did not respond within the configured time. Check service latency or increase the timeout, then retry.",
          "模型未在设定时间内响应，请检查服务延迟或适当增加超时时间后重试。",
        ),
        retryable: true,
      });
    case "feedback_model_unreachable":
      return withTechnicalDetail({
        title: localized("Could not reach the feedback model", "无法连接复盘模型"),
        description: localized(
          "The request failed before a model response was received. Check DNS, network access, proxy settings, and the configured endpoint.",
          "请求在收到模型响应前失败，请检查 DNS、网络、代理设置以及模型接口地址。",
        ),
        retryable: true,
      });
    case "feedback_model_http_error":
      return withTechnicalDetail({
        title: localized("Feedback service rejected the request", "复盘服务拒绝了请求"),
        description: localized(
          "The provider returned an HTTP error. Check the status below, API credentials, quota, and provider availability before retrying.",
          "模型服务返回了 HTTP 错误，请根据下方状态检查 API 凭证、额度和服务可用性后重试。",
        ),
        retryable: true,
      });
    case "feedback_model_invalid_response":
      return withTechnicalDetail({
        title: localized(
          "Feedback service response was invalid",
          "复盘服务响应格式异常",
        ),
        description: localized(
          "The provider was reachable, but its API response did not contain a usable completion. Verify endpoint and model compatibility, then retry.",
          "已连接到模型服务，但其 API 响应中没有可用的生成结果，请检查接口地址及模型兼容性后重试。",
        ),
        retryable: true,
      });
    case "feedback_persistence_failed":
      return withTechnicalDetail({
        title: localized("Feedback could not be saved", "复盘结果保存失败"),
        description: localized(
          "The model generated a report, but writing it to the conversation database failed. Check database access and storage space, then retry.",
          "模型已经生成复盘，但写入会话数据库时失败，请检查数据库访问权限和磁盘空间后重试。",
        ),
        retryable: true,
      });
    case "feedback_invalid_output": {
      const legacyShortConversationFailure =
        userTurns > 0 &&
        userTurns < 3 &&
        /moments|highlight/i.test(errorMessage ?? "");
      return withTechnicalDetail({
        title: legacyShortConversationFailure
          ? localized(
              "A legacy short-conversation rule rejected this report",
              "旧版短对话规则拒绝了本次复盘",
            )
          : localized(
              "Generated feedback failed validation",
              "生成的复盘内容校验失败",
            ),
        description: legacyShortConversationFailure
          ? localized(
              `This session has only ${userTurns} learner turn(s), but the old report format required at least three highlights. The rule has been relaxed; retry to regenerate the report.`,
              `本次会话只有 ${userTurns} 轮学员发言，而旧版格式强制要求至少 3 个关键时刻。该规则现已放宽，请重试生成。`,
            )
          : localized(
              "The model responded, but required core fields or criterion references were still invalid after automatic retries. Retry to request a fresh report.",
              "模型已经返回内容，但核心字段或评分标准引用在自动重试后仍未通过校验，请重试生成一份新复盘。",
            ),
        retryable: true,
      });
    }
    case "feedback_generation_failed":
      return withTechnicalDetail({
        title: localized("Feedback generation failed", "复盘生成发生未知错误"),
        description: localized(
          "An uncategorized error interrupted feedback generation. Use the technical detail below to locate the failing step, then retry.",
          "复盘生成被一个尚未分类的错误中止，请根据下方技术详情定位问题后重试。",
        ),
        retryable: true,
      });
    default:
      return withTechnicalDetail({
        title: localized("Feedback generation failed", "复盘生成失败"),
        description: localized(
          "The server reported an unknown feedback error. Review the technical detail and server logs before retrying.",
          "服务端返回了未知的复盘错误，请查看技术详情和服务端日志后重试。",
        ),
        retryable: true,
      });
  }
}
