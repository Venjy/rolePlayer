import {
  conversationDetailSchema,
  conversationListSchema,
  type ConversationDetail,
  type ConversationDownloadFormat,
  type ConversationList,
  type CreateConversationInput,
} from "../../shared/conversation-history";
import {
  conversationFeedbackViewSchema,
  type ConversationFeedbackView,
} from "../../shared/conversation-feedback";

interface ApiErrorBody {
  message?: string;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Preserve the original HTTP failure when the response has no JSON body.
    }
    throw new Error(body?.message ?? `Request failed with HTTP ${response.status}.`);
  }

  return parse(await response.json());
}

export function fetchConversations(
  signal?: AbortSignal,
): Promise<ConversationList> {
  return requestJson(
    "/api/conversations",
    { method: "GET", signal },
    (value) => conversationListSchema.parse(value),
  );
}

export function createConversation(
  input: CreateConversationInput,
): Promise<ConversationDetail> {
  return requestJson(
    "/api/conversations",
    { method: "POST", body: JSON.stringify(input) },
    (value) => conversationDetailSchema.parse(value),
  );
}

export function fetchConversation(
  id: number,
  signal?: AbortSignal,
): Promise<ConversationDetail> {
  return requestJson(
    `/api/conversations/${encodeURIComponent(id)}`,
    { method: "GET", signal },
    (value) => conversationDetailSchema.parse(value),
  );
}

export async function deleteConversation(id: number): Promise<void> {
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (response.ok) return;

  let body: ApiErrorBody | undefined;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Preserve the HTTP status when the response has no JSON body.
  }
  throw new Error(body?.message ?? `Request failed with HTTP ${response.status}.`);
}

export function endConversation(id: number): Promise<ConversationFeedbackView> {
  return requestJson(
    `/api/conversations/${encodeURIComponent(id)}/end`,
    { method: "POST" },
    (value) => conversationFeedbackViewSchema.parse(value),
  );
}

export function pauseConversation(id: number): Promise<ConversationDetail> {
  return requestJson(
    `/api/conversations/${encodeURIComponent(id)}/pause`,
    { method: "POST" },
    (value) => conversationDetailSchema.parse(value),
  );
}

export function resumeConversation(id: number): Promise<ConversationDetail> {
  return requestJson(
    `/api/conversations/${encodeURIComponent(id)}/resume`,
    { method: "POST" },
    (value) => conversationDetailSchema.parse(value),
  );
}

export function restartConversation(id: number): Promise<ConversationDetail> {
  return requestJson(
    `/api/conversations/${encodeURIComponent(id)}/restart`,
    { method: "POST" },
    (value) => conversationDetailSchema.parse(value),
  );
}

export function fetchConversationFeedback(
  id: number,
  signal?: AbortSignal,
): Promise<ConversationFeedbackView> {
  return requestJson(
    `/api/conversations/${encodeURIComponent(id)}/feedback`,
    { method: "GET", signal },
    (value) => conversationFeedbackViewSchema.parse(value),
  );
}

export function retryConversationFeedback(
  id: number,
): Promise<ConversationFeedbackView> {
  return requestJson(
    `/api/conversations/${encodeURIComponent(id)}/feedback/retry`,
    { method: "POST" },
    (value) => conversationFeedbackViewSchema.parse(value),
  );
}

export async function downloadConversation(
  id: number,
  format: ConversationDownloadFormat,
): Promise<void> {
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(id)}/download?format=${encodeURIComponent(format)}`,
  );
  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Preserve the HTTP status when an intermediary returned a non-JSON body.
    }
    throw new Error(body?.message ?? `Request failed with HTTP ${response.status}.`);
  }

  const fallbackExtension = format === "text" ? "txt" : format === "audio" ? "mp3" : "zip";
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = /filename="([^"]+)"/i.exec(disposition);
  const filename = filenameMatch?.[1] ?? `conversation-${id}.${fallbackExtension}`;
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
