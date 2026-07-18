import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  conversationDetailSchema,
  conversationMessageRoleSchema,
  conversationMessageSchema,
  conversationSummarySchema,
  createConversationInputSchema,
  type ConversationDetail,
  type ConversationMessage,
  type ConversationSummary,
  type CreateConversationInput,
} from "../../shared/conversation-history";
import type {
  Difficulty,
  Persona,
  Scenario,
} from "../../shared/role-play-catalog";
import {
  personaSchema,
  scenarioSchema,
} from "../../shared/role-play-catalog";
import { compileRolePlayInstructions } from "../../shared/role-play-instructions";
import {
  MAX_REALTIME_INSTRUCTIONS_LENGTH,
  qwenVoiceSchema,
  type QwenVoice,
} from "../../shared/realtime-protocol";
import type { ApplicationDatabase } from "../database/database";

interface ConversationSessionRow {
  id: string;
  persona_json: string;
  scenario_json: string;
  difficulty: string;
  locale: string;
  instructions: string;
  voice: string;
  created_at: string;
  updated_at: string;
}

interface ConversationSummaryRow extends ConversationSessionRow {
  message_count: number;
  last_message_text: string | null;
}

interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  position: number;
  role: string;
  text: string;
  interrupted: number;
  source_item_id: string | null;
  response_id: string | null;
  created_at: string;
}

const appendMessageInputSchema = z.object({
  conversationId: z.string().trim().min(1).max(100),
  role: conversationMessageRoleSchema,
  text: z.string().trim().min(1).max(100_000),
  interrupted: z.boolean(),
  sourceItemId: z.string().trim().min(1).max(200).optional(),
  responseId: z.string().trim().min(1).max(200).optional(),
});

export interface AppendConversationMessageInput {
  conversationId: string;
  role: ConversationMessage["role"];
  text: string;
  interrupted: boolean;
  sourceItemId?: string;
  responseId?: string;
}

export interface RuntimeConversation {
  id: string;
  persona: Persona;
  scenario: Scenario;
  difficulty: Difficulty;
  locale: CreateConversationInput["locale"];
  instructions: string;
  voice: QwenVoice;
  messages: ConversationMessage[];
}

export class ConversationNotFoundError extends Error {
  public constructor(public readonly conversationId: string) {
    super(`No conversation exists with ID "${conversationId}".`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationInstructionsTooLongError extends Error {
  public constructor(
    public readonly actualLength: number,
    public readonly maximumLength = MAX_REALTIME_INSTRUCTIONS_LENGTH,
  ) {
    super(
      `The conversation Instructions are too long (${actualLength}/${maximumLength} characters).`,
    );
    this.name = "ConversationInstructionsTooLongError";
  }
}

export class ConversationMessageIdentityConflictError extends Error {
  public constructor() {
    super(
      "The source item ID and response ID refer to different persisted messages.",
    );
    this.name = "ConversationMessageIdentityConflictError";
  }
}

/** Owns durable conversation snapshots and finalized text messages. */
export class ConversationRepository {
  public constructor(private readonly database: ApplicationDatabase) {}

  public createConversation(input: CreateConversationInput): ConversationDetail {
    const parsed = createConversationInputSchema.parse(input);
    const instructions = compileRolePlayInstructions(parsed);
    if (instructions.length > MAX_REALTIME_INSTRUCTIONS_LENGTH) {
      throw new ConversationInstructionsTooLongError(instructions.length);
    }

    const id = `conversation_${randomUUID()}`;
    const timestamp = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO conversation_sessions (
          id, persona_json, scenario_json, difficulty, locale,
          instructions, voice, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        JSON.stringify(parsed.persona),
        JSON.stringify(parsed.scenario),
        parsed.difficulty,
        parsed.locale,
        instructions,
        parsed.persona.voice,
        timestamp,
        timestamp,
      );

    return this.requireConversation(id);
  }

  public listConversations(): ConversationSummary[] {
    const rows = this.connection
      .prepare(
        `SELECT
          sessions.*,
          COUNT(messages.id) AS message_count,
          (
            SELECT latest.text
            FROM conversation_messages AS latest
            WHERE latest.conversation_id = sessions.id
            ORDER BY latest.position DESC
            LIMIT 1
          ) AS last_message_text
        FROM conversation_sessions AS sessions
        LEFT JOIN conversation_messages AS messages
          ON messages.conversation_id = sessions.id
        GROUP BY sessions.id
        ORDER BY sessions.updated_at DESC, sessions.id DESC`,
      )
      .all() as unknown as ConversationSummaryRow[];

    return rows.map(mapConversationSummaryRow);
  }

  public getConversation(id: string): ConversationDetail | null {
    const row = this.getSessionRow(id);
    if (!row) return null;
    const messages = this.listMessages(id);
    return mapConversationDetail(row, messages);
  }

  public getRuntimeConversation(
    id: string,
    maximumUserTurns?: number,
  ): RuntimeConversation | null {
    const row = this.getSessionRow(id);
    if (!row) return null;
    if (
      maximumUserTurns !== undefined &&
      (!Number.isSafeInteger(maximumUserTurns) || maximumUserTurns < 1)
    ) {
      throw new RangeError("maximumUserTurns must be a positive integer.");
    }

    return {
      id: row.id,
      persona: parsePersona(row.persona_json),
      scenario: parseScenario(row.scenario_json),
      difficulty: parseDifficulty(row.difficulty),
      locale: parseLocale(row.locale),
      instructions: row.instructions,
      voice: qwenVoiceSchema.parse(row.voice),
      messages:
        maximumUserTurns === undefined
          ? this.listMessages(id)
          : this.listRecentMessages(id, maximumUserTurns),
    };
  }

  public appendMessage(
    input: AppendConversationMessageInput,
  ): ConversationMessage {
    const parsed = appendMessageInputSchema.parse(input);
    const existingSession = this.getSessionRow(parsed.conversationId);
    if (!existingSession) {
      throw new ConversationNotFoundError(parsed.conversationId);
    }

    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const duplicates = this.findDuplicateMessages(parsed);
      if (duplicates.length > 1) {
        throw new ConversationMessageIdentityConflictError();
      }
      if (duplicates[0]) {
        const duplicate = duplicates[0];
        if (
          (parsed.sourceItemId &&
            duplicate.source_item_id &&
            parsed.sourceItemId !== duplicate.source_item_id) ||
          (parsed.responseId &&
            duplicate.response_id &&
            parsed.responseId !== duplicate.response_id)
        ) {
          throw new ConversationMessageIdentityConflictError();
        }
        if (
          (parsed.sourceItemId && !duplicate.source_item_id) ||
          (parsed.responseId && !duplicate.response_id)
        ) {
          this.connection
            .prepare(
              `UPDATE conversation_messages
               SET source_item_id = COALESCE(source_item_id, ?),
                   response_id = COALESCE(response_id, ?)
               WHERE id = ?`,
            )
            .run(
              parsed.sourceItemId ?? null,
              parsed.responseId ?? null,
              duplicate.id,
            );
        }
        const result = mapConversationMessageRow(duplicate);
        this.connection.exec("COMMIT");
        return result;
      }

      const positionRow = this.connection
        .prepare(
          `SELECT COALESCE(MAX(position), -1) + 1 AS position
           FROM conversation_messages
           WHERE conversation_id = ?`,
        )
        .get(parsed.conversationId) as unknown as { position: number };
      const id = `message_${randomUUID()}`;
      const timestamp = nextTimestamp(existingSession.updated_at);

      this.connection
        .prepare(
          `INSERT INTO conversation_messages (
            id, conversation_id, position, role, text, interrupted,
            source_item_id, response_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          parsed.conversationId,
          positionRow.position,
          parsed.role,
          parsed.text,
          parsed.interrupted ? 1 : 0,
          parsed.sourceItemId ?? null,
          parsed.responseId ?? null,
          timestamp,
        );
      this.connection
        .prepare(
          `UPDATE conversation_sessions
           SET updated_at = ?
           WHERE id = ?`,
        )
        .run(timestamp, parsed.conversationId);
      const result = this.requireMessage(id);
      this.connection.exec("COMMIT");

      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  private get connection() {
    return this.database.raw;
  }

  private getSessionRow(id: string): ConversationSessionRow | undefined {
    return this.connection
      .prepare("SELECT * FROM conversation_sessions WHERE id = ?")
      .get(id) as unknown as ConversationSessionRow | undefined;
  }

  private requireConversation(id: string): ConversationDetail {
    const conversation = this.getConversation(id);
    if (!conversation) throw new ConversationNotFoundError(id);
    return conversation;
  }

  private listMessages(conversationId: string): ConversationMessage[] {
    const rows = this.connection
      .prepare(
        `SELECT *
         FROM conversation_messages
         WHERE conversation_id = ?
         ORDER BY position`,
      )
      .all(conversationId) as unknown as ConversationMessageRow[];
    return rows.map(mapConversationMessageRow);
  }

  private listRecentMessages(
    conversationId: string,
    maximumUserTurns: number,
  ): ConversationMessage[] {
    const rows = this.connection
      .prepare(
        `WITH recent_user_positions AS (
           SELECT position
           FROM conversation_messages
           WHERE conversation_id = ? AND role = 'user'
           ORDER BY position DESC
           LIMIT ?
         )
         SELECT *
         FROM conversation_messages
         WHERE conversation_id = ?
           AND position >= COALESCE(
             (SELECT MIN(position) FROM recent_user_positions),
             9223372036854775807
           )
         ORDER BY position`,
      )
      .all(
        conversationId,
        maximumUserTurns,
        conversationId,
      ) as unknown as ConversationMessageRow[];
    return rows.map(mapConversationMessageRow);
  }

  private requireMessage(id: string): ConversationMessage {
    const row = this.connection
      .prepare("SELECT * FROM conversation_messages WHERE id = ?")
      .get(id) as unknown as ConversationMessageRow | undefined;
    if (!row) throw new Error(`Conversation message "${id}" disappeared after writing.`);
    return mapConversationMessageRow(row);
  }

  private findDuplicateMessages(
    input: z.infer<typeof appendMessageInputSchema>,
  ): ConversationMessageRow[] {
    if (!input.sourceItemId && !input.responseId) return [];

    return this.connection
      .prepare(
        `SELECT *
         FROM conversation_messages
         WHERE conversation_id = ?
           AND (
             (? IS NOT NULL AND source_item_id = ?)
             OR (? IS NOT NULL AND response_id = ?)
           )
         ORDER BY position`,
      )
      .all(
        input.conversationId,
        input.sourceItemId ?? null,
        input.sourceItemId ?? null,
        input.responseId ?? null,
        input.responseId ?? null,
      ) as unknown as ConversationMessageRow[];
  }
}

function mapConversationSummaryRow(
  row: ConversationSummaryRow,
): ConversationSummary {
  const persona = parsePersona(row.persona_json);
  const scenario = parseScenario(row.scenario_json);
  return conversationSummarySchema.parse({
    id: row.id,
    personaName: persona.name,
    scenarioName: scenario.name,
    difficulty: row.difficulty,
    locale: row.locale,
    messageCount: row.message_count,
    lastMessagePreview: row.last_message_text?.slice(0, 240) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapConversationDetail(
  row: ConversationSessionRow,
  messages: ConversationMessage[],
): ConversationDetail {
  const persona = parsePersona(row.persona_json);
  const scenario = parseScenario(row.scenario_json);
  return conversationDetailSchema.parse({
    id: row.id,
    personaName: persona.name,
    scenarioName: scenario.name,
    difficulty: row.difficulty,
    locale: row.locale,
    messageCount: messages.length,
    lastMessagePreview: messages.at(-1)?.text.slice(0, 240) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    persona,
    scenario,
    messages,
  });
}

function mapConversationMessageRow(
  row: ConversationMessageRow,
): ConversationMessage {
  return conversationMessageSchema.parse({
    id: row.id,
    role: row.role,
    text: row.text,
    interrupted: row.interrupted === 1,
    createdAt: row.created_at,
  });
}

function parsePersona(value: string): Persona {
  return personaSchema.parse(JSON.parse(value) as unknown);
}

function parseScenario(value: string): Scenario {
  return scenarioSchema.parse(JSON.parse(value) as unknown);
}

function parseDifficulty(value: string): Difficulty {
  return createConversationInputSchema.shape.difficulty.parse(value);
}

function parseLocale(value: string): CreateConversationInput["locale"] {
  return createConversationInputSchema.shape.locale.parse(value);
}

function nextTimestamp(previous: string): string {
  const now = Date.now();
  const previousTime = Date.parse(previous);
  return new Date(
    Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now,
  ).toISOString();
}
