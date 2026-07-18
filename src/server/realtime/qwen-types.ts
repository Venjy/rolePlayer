import type { QwenVoice } from "../../shared/realtime-protocol";

export interface QwenSessionConfiguration {
  instructions: string;
  voice: QwenVoice;
  maxHistoryTurns: number;
}

export interface QwenConversationContent {
  type?: string;
  text?: string;
  transcript?: string;
}

export interface QwenConversationItem {
  id?: string;
  object?: string;
  type?: "message" | "function_call" | "function_call_output";
  status?: "in_progress" | "completed";
  role?: "system" | "user" | "assistant";
  content?: QwenConversationContent[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

export interface QwenServerEvent {
  type: string;
  event_id?: string;
  session?: { id?: string };
  previous_item_id?: string;
  item?: QwenConversationItem;
  item_id?: string;
  response_id?: string;
  text?: string;
  stash?: string;
  transcript?: string;
  delta?: string;
  response?: {
    id?: string;
    status?: "completed" | "cancelled" | "failed";
    status_details?: {
      type?: string;
      reason?: string;
      error?: { code?: string; message?: string };
    };
    output?: QwenConversationItem[];
  };
  error?: {
    type?: string;
    code?: string;
    message?: string;
    param?: string;
  };
}
