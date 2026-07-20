import type { LocalizedText } from "../i18n";
import { RealtimeServerError } from "../realtime/realtime-client";

export type UiError = string | LocalizedText;

const KNOWN_CLIENT_ERRORS: Readonly<Record<string, LocalizedText>> = {
  "Realtime client is already connected.": {
    en: "The realtime client is already connected.",
    zh: "实时客户端已经连接。",
  },
  "Timed out while starting the realtime session.": {
    en: "Timed out while starting the realtime session.",
    zh: "启动实时会话超时。",
  },
  "Timed out while saving the assistant response.": {
    en: "Timed out while saving the AI response. The session was kept open to avoid silently losing history.",
    zh: "保存 AI 回复超时。为避免静默丢失历史，当前会话仍保持打开。",
  },
  "Timed out while saving the user transcript.": {
    en: "Timed out while saving your transcript. The session was kept open to avoid silently losing history.",
    zh: "保存你的转写超时。为避免静默丢失历史，当前会话仍保持打开。",
  },
  "The realtime connection closed before pending conversation data was saved.": {
    en: "The realtime connection closed before pending conversation data was saved.",
    zh: "实时连接在待处理的对话数据保存前已关闭。",
  },
  "The realtime gateway returned a malformed message.": {
    en: "The realtime gateway returned a malformed message.",
    zh: "实时网关返回了格式异常的消息。",
  },
  "Could not send the assistant playback receipt.": {
    en: "Could not confirm how much of the AI response was played.",
    zh: "无法确认 AI 回复已播放到哪个位置。",
  },
  "Could not connect to the local realtime gateway.": {
    en: "Could not connect to the local realtime gateway.",
    zh: "无法连接本地实时网关。",
  },
  "Realtime connection closed before it was ready.": {
    en: "The realtime connection closed before it was ready.",
    zh: "实时连接在就绪前已关闭。",
  },
  "Realtime WebSocket is not open.": {
    en: "The realtime connection is not open.",
    zh: "实时连接尚未打开。",
  },
  "The connection is too slow to stream microphone audio.": {
    en: "The connection is too slow to stream microphone audio.",
    zh: "连接速度过慢，无法传输麦克风音频。",
  },
  "This browser does not support microphone capture.": {
    en: "This browser does not support microphone capture.",
    zh: "当前浏览器不支持麦克风录音。",
  },
  "Audio engine is not prepared.": {
    en: "The audio engine is not ready.",
    zh: "音频引擎尚未就绪。",
  },
  "Received overlapping realtime audio responses.": {
    en: "Overlapping realtime audio responses were received.",
    zh: "收到了重叠的实时音频回应。",
  },
  "Audio engine was disposed.": {
    en: "The audio engine was closed.",
    zh: "音频引擎已关闭。",
  },
  "Timed out while flushing microphone audio.": {
    en: "Timed out while finishing the microphone recording.",
    zh: "结束麦克风录音时超时。",
  },
};

const SERVER_ERROR_LABELS: Readonly<Record<string, LocalizedText>> = {
  ALREADY_CONFIGURED: {
    en: "The session is already configured.",
    zh: "会话已经完成配置。",
  },
  AUDIO_FORWARD_FAILED: {
    en: "Could not forward microphone audio.",
    zh: "无法转发麦克风音频。",
  },
  TRANSCRIPTION_FAILED: {
    en: "The user audio could not be transcribed.",
    zh: "无法识别用户语音。",
  },
  INPUT_ALREADY_ACTIVE: {
    en: "A user turn is already active.",
    zh: "当前已有一轮用户输入正在进行。",
  },
  USER_TURN_PENDING: {
    en: "Wait for your previous transcript to be saved before speaking again.",
    zh: "请等待上一轮语音转写保存完成后再说话。",
  },
  NO_ACTIVE_INPUT: {
    en: "No recording is active.",
    zh: "当前没有正在进行的录音。",
  },
  RECORDING_TOO_SHORT: {
    en: "Please speak for at least 100 ms before submitting.",
    zh: "请至少说话 100 毫秒后再发送。",
  },
  PLAYBACK_BACKPRESSURE: {
    en: "The browser connection is too slow for realtime playback.",
    zh: "浏览器连接速度过慢，无法实时播放。",
  },
  RESPONSE_FAILED: {
    en: "The AI customer could not generate a response.",
    zh: "AI 客户无法生成回复。",
  },
  RESPONSE_RETRYING: {
    en: "The AI response failed or was empty. Retrying once.",
    zh: "AI 回复生成失败或内容为空，正在自动重试一次。",
  },
  EMPTY_RESPONSE: {
    en: "The AI customer returned an empty response after retrying. Please speak again.",
    zh: "AI 客户重试后仍返回空回复，请重新说一遍。",
  },
  RESPONSE_TIMEOUT: {
    en: "The AI response timed out.",
    zh: "等待 AI 回复超时。",
  },
  RESPONSE_REQUEST_REJECTED: {
    en: "Qwen rejected the AI response request.",
    zh: "Qwen 拒绝了本次 AI 回复请求。",
  },
  RESPONSE_RETRY_UNAVAILABLE: {
    en: "The AI response cannot be retried while another turn is active.",
    zh: "当前仍有一轮对话正在处理，暂时无法重试 AI 回复。",
  },
  NO_RESPONSE_TO_RETRY: {
    en: "There is no unanswered saved user turn to retry.",
    zh: "没有已保存但尚未回答的用户发言可供重试。",
  },
  QWEN_SERVER_ERROR: {
    en: "Qwen reported a server-side error.",
    zh: "Qwen 服务端发生错误。",
  },
  MALFORMED_UPSTREAM_EVENT: {
    en: "Qwen returned a malformed realtime event.",
    zh: "Qwen 返回了格式异常的实时事件。",
  },
  INPUT_CLEAR_FAILED: {
    en: "The cancelled recording could not be cleared safely.",
    zh: "无法安全清除已取消的录音。",
  },
  UNKNOWN_RESPONSE: {
    en: "The playback response is no longer active.",
    zh: "要播放的回应已不再活动。",
  },
  CONTEXT_STATE_UNCERTAIN: {
    en: "Conversation context repair failed.",
    zh: "对话上下文修复失败。",
  },
  HISTORY_PERSISTENCE_FAILED: {
    en: "The conversation history could not be saved.",
    zh: "无法保存对话历史。",
  },
  CONVERSATION_NOT_FOUND: {
    en: "The selected conversation no longer exists.",
    zh: "所选历史会话已不存在。",
  },
  CONVERSATION_ENDED: {
    en: "This conversation has ended. Open its feedback instead.",
    zh: "该会话已结束，请查看会话复盘。",
  },
  UPSTREAM_CLOSED: {
    en: "The Qwen connection closed unexpectedly.",
    zh: "Qwen 连接意外关闭。",
  },
  SESSION_CONFIGURATION_FAILED: {
    en: "The realtime session could not be configured.",
    zh: "无法配置实时会话。",
  },
  SESSION_NOT_READY: {
    en: "The realtime session is not ready yet.",
    zh: "实时会话尚未就绪。",
  },
  GATEWAY_ERROR: {
    en: "The realtime gateway could not process the request.",
    zh: "实时网关无法处理该请求。",
  },
  INVALID_AUDIO_FRAME: {
    en: "An invalid microphone audio frame was received.",
    zh: "收到了无效的麦克风音频帧。",
  },
  INVALID_JSON: {
    en: "An invalid realtime control message was received.",
    zh: "收到了无效的实时控制消息。",
  },
};

export function readableError(error: unknown): UiError {
  if (error instanceof RealtimeServerError) {
    return readableServerError(error.code, error.message);
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return {
      en: "Microphone permission was denied. Allow microphone access in your browser's site settings, then start the session again.",
      zh: "麦克风权限被拒绝。请在浏览器的网站设置中允许麦克风，然后重新开始会话。",
    };
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return {
      en: "No microphone was found. Connect an input device and try again.",
      zh: "没有找到可用的麦克风，请连接输入设备后重试。",
    };
  }
  if (error instanceof Error) {
    const closeMatch = /^Realtime connection closed before it was ready \((\d+)\)\.$/.exec(
      error.message,
    );
    if (closeMatch) {
      return {
        en: error.message,
        zh: `实时连接在就绪前已关闭（${closeMatch[1]}）。`,
      };
    }
  }
  return error instanceof Error
    ? (KNOWN_CLIENT_ERRORS[error.message] ?? error.message)
    : {
        en: "An unknown error occurred. Please try again.",
        zh: "发生了未知错误，请重试。",
      };
}

export function readableServerError(code: string, message: string): UiError {
  const knownError = SERVER_ERROR_LABELS[code];
  return knownError ? { en: message || knownError.en, zh: knownError.zh } : message;
}
