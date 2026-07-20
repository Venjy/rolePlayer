import type { AssistantDraft, TranscriptTurn } from "../session/session-types";

export type UiPreviewMode =
  | "session"
  | "paused"
  | "recording"
  | "long"
  | "free"
  | null;

interface UiPreviewFixture {
  mode: Exclude<UiPreviewMode, null>;
  turns: TranscriptTurn[];
  assistantDraft: AssistantDraft | null;
}

function getUiPreviewMode(): UiPreviewMode {
  const preview = new URLSearchParams(window.location.search).get("preview");
  return preview === "session" ||
    preview === "paused" ||
    preview === "recording" ||
    preview === "long" ||
    preview === "free"
    ? preview
    : null;
}

function createPreviewTurns(): TranscriptTurn[] {
  const now = Date.now();
  return [
    {
      id: "preview-user-1",
      role: "user",
      text: "你好 Alex，我想先了解一下你们目前筛选销售线索的方式。",
      timestamp: new Date(now - 82_000),
    },
    {
      id: "preview-assistant-1",
      role: "assistant",
      text: "我们主要还是依靠销售自己判断。你们的方案具体能解决什么问题？",
      timestamp: new Date(now - 64_000),
    },
    {
      id: "preview-user-2",
      role: "user",
      text: "它可以根据客户画像和历史互动自动排序，让团队先跟进最有机会的客户。",
      timestamp: new Date(now - 38_000),
    },
  ];
}

function createUiPreviewFixture(): UiPreviewFixture | null {
  const mode = getUiPreviewMode();
  if (!mode) return null;
  return {
    mode,
    turns: createPreviewTurns(),
    assistantDraft:
      mode === "session"
        ? {
            responseId: "preview-response",
            text: "听起来能节省不少时间。不过我们的数据分散在几个系统里，",
          }
        : null,
  };
}

export const UI_PREVIEW_FIXTURE = import.meta.env.DEV
  ? createUiPreviewFixture()
  : null;
