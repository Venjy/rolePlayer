import type { Difficulty } from "../../shared/role-play-catalog";
import type {
  PersonaSnapshot,
  ScenarioSnapshot,
} from "../../shared/conversation-history";

export type VoiceInputMode =
  | "push-to-talk"
  | "long-recording"
  | "free-conversation";
export type LongRecordingAction = "starting" | "submitting" | "cancelling";
export type SessionControlAction = "pausing" | "resuming" | "restarting";

export interface FreeConversationAudioRouting {
  enabled: boolean;
  turnOpen: boolean;
  preRoll: ArrayBuffer[];
}

export interface ActiveSessionConfig {
  persona: PersonaSnapshot;
  scenario: ScenarioSnapshot;
  difficulty: Difficulty;
}

export interface TranscriptTurn {
  id: string | number;
  responseId?: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
  interrupted?: boolean;
}

export interface AssistantDraft {
  responseId: string;
  text: string;
}
