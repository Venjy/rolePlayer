import { z } from "zod";
import {
  conversationDetailSchema,
  conversationMessageRoleSchema,
  conversationMessageSchema,
  conversationSummarySchema,
  conversationLocaleSchema,
  personaSnapshotSchema,
  scenarioSnapshotSchema,
  type ConversationDetail,
  type ConversationMessage,
  type PersonaSnapshot,
  type ScenarioSnapshot,
  type ConversationSummary,
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
  localizePersona,
  localizeScenario,
} from "../../shared/role-play-localization";
import {
  MAX_REALTIME_INSTRUCTIONS_LENGTH,
  qwenVoiceSchema,
  type QwenVoice,
} from "../../shared/realtime-protocol";
import type { ApplicationDatabase } from "../database/database";
import {
  formatDatabaseTimestamp,
  nextDatabaseTimestamp,
  normalizeDatabaseTimestamp,
} from "../database/database-time";
import { databaseIdSchema } from "../../shared/database-id";

interface ConversationSessionRow {
  id: number;
  difficulty: string;
  locale: string;
  instructions: string;
  voice: string;
  status: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationSummaryRow extends ConversationSessionRow {
  persona_name: string;
  persona_name_zh_cn: string;
  scenario_name: string;
  scenario_name_zh_cn: string;
  message_count: number;
  audio_message_count: number;
  last_message_text: string | null;
  feedback_status: string | null;
}

interface PersonaSnapshotRow {
  conversation_id: number;
  source_persona_id: number;
  name: string;
  name_zh_cn: string;
  gender: string;
  age: number | null;
  occupation: string;
  occupation_zh_cn: string;
  background: string;
  background_zh_cn: string;
  personality_traits_json: string;
  personality_traits_zh_cn_json: string;
  communication_style: string;
  communication_style_zh_cn: string;
  behavior_notes: string;
  behavior_notes_zh_cn: string;
  motivations_json: string;
  motivations_zh_cn_json: string;
  concerns_json: string;
  concerns_zh_cn_json: string;
  voice: string;
  source_created_at: string;
  source_updated_at: string;
}

interface ScenarioSnapshotRow {
  conversation_id: number;
  source_scenario_id: number;
  name: string;
  name_zh_cn: string;
  description: string;
  description_zh_cn: string;
  goals_json: string;
  goals_zh_cn_json: string;
  suggested_skill_focus_json: string;
  suggested_skill_focus_zh_cn_json: string;
  success_criteria_json: string;
  success_criteria_zh_cn_json: string;
  tone_style: string;
  tone_style_zh_cn: string;
  interrupt_frequency: string | null;
  speaking_pace: string | null;
  source_created_at: string;
  source_updated_at: string;
}

interface SnapshotScoringCriterionRow {
  position: number;
  name: string;
  name_zh_cn: string;
  weight: number;
}

interface ConversationMessageRow {
  id: number;
  conversation_id: number;
  position: number;
  role: string;
  text: string;
  interrupted: number;
  source_item_id: string | null;
  response_id: string | null;
  created_at: string;
}

interface ConversationAudioSegmentRow {
  message_id: number;
  position: number;
  role: string;
  sample_rate: number;
  pcm: Uint8Array;
  duration_ms: number;
}

export const MAX_PERSISTED_MESSAGE_AUDIO_BYTES = 32 * 1024 * 1024;

const conversationMessageAudioSchema = z
  .object({
    sampleRate: z.union([z.literal(16_000), z.literal(24_000)]),
    pcm: z.custom<Buffer>(
      (value) => Buffer.isBuffer(value),
      "PCM audio must be provided as a Buffer.",
    ),
  })
  .superRefine((audio, context) => {
    if (audio.pcm.length === 0 || audio.pcm.length % 2 !== 0) {
      context.addIssue({
        code: "custom",
        path: ["pcm"],
        message: "PCM16 audio must contain a non-empty, even number of bytes.",
      });
    }
    if (audio.pcm.length > MAX_PERSISTED_MESSAGE_AUDIO_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["pcm"],
        message: `PCM audio cannot exceed ${MAX_PERSISTED_MESSAGE_AUDIO_BYTES} bytes per message.`,
      });
    }
  });

const appendMessageInputSchema = z.object({
  conversationId: databaseIdSchema,
  role: conversationMessageRoleSchema,
  text: z.string().trim().min(1).max(100_000),
  interrupted: z.boolean(),
  sourceItemId: z.string().trim().min(1).max(200).optional(),
  responseId: z.string().trim().min(1).max(200).optional(),
  audio: conversationMessageAudioSchema.optional(),
});

export interface AppendConversationMessageInput {
  conversationId: number;
  role: ConversationMessage["role"];
  text: string;
  interrupted: boolean;
  sourceItemId?: string;
  responseId?: string;
  audio?: {
    sampleRate: 16_000 | 24_000;
    pcm: Buffer;
  };
}

export interface ConversationAudioSegment {
  messageId: number;
  position: number;
  role: ConversationMessage["role"];
  sampleRate: 16_000 | 24_000;
  pcm: Buffer;
  durationMs: number;
}

export interface RuntimeConversation {
  id: number;
  persona: PersonaSnapshot;
  scenario: ScenarioSnapshot;
  difficulty: Difficulty;
  locale: z.infer<typeof conversationLocaleSchema>;
  instructions: string;
  voice: QwenVoice;
  messages: ConversationMessage[];
}

export interface CreateConversationSnapshotInput {
  persona: Persona;
  scenario: Scenario;
  difficulty: Difficulty;
  locale: z.infer<typeof conversationLocaleSchema>;
}

const createConversationSnapshotInputSchema = z
  .object({
    persona: personaSchema,
    scenario: scenarioSchema,
    difficulty: z.enum(["easy", "medium", "hard"]),
    locale: conversationLocaleSchema,
  })
  .superRefine((value, context) => {
    if (!value.scenario.allowedPersonaIds.includes(value.persona.id)) {
      context.addIssue({
        code: "custom",
        path: ["persona", "id"],
        message: "The persona is not compatible with the selected scenario.",
      });
    }
  });

export class ConversationNotFoundError extends Error {
  public constructor(public readonly conversationId: number) {
    super(`No conversation exists with ID "${conversationId}".`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationEndedError extends Error {
  public constructor(public readonly conversationId: number) {
    super(`Conversation "${conversationId}" has already ended.`);
    this.name = "ConversationEndedError";
  }
}

export class ActiveConversationDeletionError extends Error {
  public constructor(public readonly conversationId: number) {
    super(`Conversation "${conversationId}" must end before it can be deleted.`);
    this.name = "ActiveConversationDeletionError";
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

/** Owns durable conversation snapshots plus finalized text and spoken audio. */
export class ConversationRepository {
  public constructor(private readonly database: ApplicationDatabase) {}

  public createConversation(input: CreateConversationSnapshotInput): ConversationDetail {
    const parsed = createConversationSnapshotInputSchema.parse(input);
    const personaSnapshot = normalizeSnapshotTimestamps(parsed.persona);
    const scenarioSnapshot = normalizeSnapshotTimestamps(parsed.scenario);
    const localizedPersona = localizePersona(personaSnapshot, parsed.locale);
    const localizedScenario = localizeScenario(scenarioSnapshot, parsed.locale);
    const instructions = compileRolePlayInstructions({
      persona: localizedPersona,
      scenario: localizedScenario,
      difficulty: parsed.difficulty,
      locale: parsed.locale,
    });
    if (instructions.length > MAX_REALTIME_INSTRUCTIONS_LENGTH) {
      throw new ConversationInstructionsTooLongError(instructions.length);
    }

    const timestamp = formatDatabaseTimestamp();
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const write = this.connection
        .prepare(
          `INSERT INTO sessions (
            difficulty, locale, instructions, voice, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.difficulty,
          parsed.locale,
          instructions,
          personaSnapshot.voice,
          timestamp,
          timestamp,
        );
      const id = toDatabaseId(write.lastInsertRowid);
      this.insertPersonaSnapshot(id, personaSnapshot);
      this.insertScenarioSnapshot(id, scenarioSnapshot);
      this.connection.exec("COMMIT");
      return this.requireConversation(id);
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  public listConversations(): ConversationSummary[] {
    const rows = this.connection
      .prepare(
        `SELECT
          sessions.*,
          persona.name AS persona_name,
          persona.name_zh_cn AS persona_name_zh_cn,
          scenario.name AS scenario_name,
          scenario.name_zh_cn AS scenario_name_zh_cn,
          COUNT(messages.id) AS message_count,
          COUNT(message_audio.message_id) AS audio_message_count,
          feedback.status AS feedback_status,
          (
            SELECT latest.text
            FROM messages AS latest
            WHERE latest.conversation_id = sessions.id
            ORDER BY latest.position DESC
            LIMIT 1
          ) AS last_message_text
        FROM sessions
        JOIN persona_snapshots AS persona
          ON persona.conversation_id = sessions.id
        JOIN scenario_snapshots AS scenario
          ON scenario.conversation_id = sessions.id
        LEFT JOIN messages
          ON messages.conversation_id = sessions.id
        LEFT JOIN message_audio
          ON message_audio.message_id = messages.id
        LEFT JOIN feedback_reports AS feedback
          ON feedback.conversation_id = sessions.id
        GROUP BY sessions.id
        ORDER BY sessions.updated_at DESC, sessions.id DESC`,
      )
      .all() as unknown as ConversationSummaryRow[];

    return rows.map(mapConversationSummaryRow);
  }

  public getConversation(id: number): ConversationDetail | null {
    const row = this.getSessionRow(id);
    if (!row) return null;
    const { persona, scenario } = this.requireSnapshots(id);
    const messages = this.listMessages(id);
    return mapConversationDetail(
      row,
      persona,
      scenario,
      messages,
      this.countAudioMessages(id),
      this.getFeedbackStatus(id),
    );
  }

  public getRuntimeConversation(
    id: number,
    maximumUserTurns?: number,
  ): RuntimeConversation | null {
    const row = this.getSessionRow(id);
    if (!row) return null;
    if (row.status === "ended") throw new ConversationEndedError(id);
    const { persona, scenario } = this.requireSnapshots(id);
    if (
      maximumUserTurns !== undefined &&
      (!Number.isSafeInteger(maximumUserTurns) || maximumUserTurns < 1)
    ) {
      throw new RangeError("maximumUserTurns must be a positive integer.");
    }

    return {
      id: row.id,
      persona: localizePersona(persona, parseLocale(row.locale)),
      scenario: localizeScenario(scenario, parseLocale(row.locale)),
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
    if (existingSession.status === "ended") {
      throw new ConversationEndedError(parsed.conversationId);
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
              `UPDATE messages
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
        if (parsed.audio) {
          this.insertMessageAudio(duplicate.id, parsed.audio, duplicate.created_at);
        }
        const result = mapConversationMessageRow(duplicate);
        this.connection.exec("COMMIT");
        return result;
      }

      const positionRow = this.connection
        .prepare(
          `SELECT COALESCE(MAX(position), -1) + 1 AS position
           FROM messages
           WHERE conversation_id = ?`,
        )
        .get(parsed.conversationId) as unknown as { position: number };
      const timestamp = nextDatabaseTimestamp(existingSession.updated_at);

      const write = this.connection
        .prepare(
          `INSERT INTO messages (
            conversation_id, position, role, text, interrupted,
            source_item_id, response_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
          `UPDATE sessions
           SET updated_at = ?
           WHERE id = ?`,
        )
        .run(timestamp, parsed.conversationId);
      const result = this.requireMessage(toDatabaseId(write.lastInsertRowid));
      if (parsed.audio) {
        this.insertMessageAudio(result.id, parsed.audio, timestamp);
      }
      this.connection.exec("COMMIT");

      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  public listConversationAudioSegments(
    conversationId: number,
  ): ConversationAudioSegment[] {
    const id = databaseIdSchema.parse(conversationId);
    const rows = this.connection
      .prepare(
        `SELECT
           messages.id AS message_id,
           messages.position,
           messages.role,
           message_audio.sample_rate,
           message_audio.pcm,
           message_audio.duration_ms
         FROM messages
         JOIN message_audio ON message_audio.message_id = messages.id
         WHERE messages.conversation_id = ?
         ORDER BY messages.position`,
      )
      .all(id) as unknown as ConversationAudioSegmentRow[];

    return rows.map((row) => ({
      messageId: row.message_id,
      position: row.position,
      role: conversationMessageRoleSchema.parse(row.role),
      sampleRate: parseAudioSampleRate(row.sample_rate),
      pcm: Buffer.from(row.pcm),
      durationMs: row.duration_ms,
    }));
  }

  /** Marks a settled conversation as immutable and records its wall-clock end. */
  public endConversation(id: number): ConversationDetail {
    const conversationId = databaseIdSchema.parse(id);
    const existing = this.getSessionRow(conversationId);
    if (!existing) throw new ConversationNotFoundError(conversationId);
    if (existing.status === "ended") return this.requireConversation(conversationId);

    const timestamp = nextDatabaseTimestamp(existing.updated_at);
    this.connection
      .prepare(
        `UPDATE sessions
         SET status = 'ended', ended_at = ?, updated_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(timestamp, timestamp, conversationId);
    return this.requireConversation(conversationId);
  }

  /** Deletes one ended session and all snapshots/messages/audio/feedback via FKs. */
  public deleteEndedConversation(id: number): void {
    const conversationId = databaseIdSchema.parse(id);
    const existing = this.getSessionRow(conversationId);
    if (!existing) throw new ConversationNotFoundError(conversationId);
    if (existing.status !== "ended") {
      throw new ActiveConversationDeletionError(conversationId);
    }

    const result = this.connection
      .prepare("DELETE FROM sessions WHERE id = ? AND status = 'ended'")
      .run(conversationId);
    if (result.changes !== 1) {
      throw new ConversationNotFoundError(conversationId);
    }
  }

  private insertPersonaSnapshot(
    conversationId: number,
    persona: Persona,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO persona_snapshots (
          conversation_id, source_persona_id, name, name_zh_cn, gender, age,
          occupation, occupation_zh_cn, background, background_zh_cn,
          personality_traits_json, personality_traits_zh_cn_json,
          communication_style, communication_style_zh_cn,
          behavior_notes, behavior_notes_zh_cn,
          motivations_json, motivations_zh_cn_json,
          concerns_json, concerns_zh_cn_json, voice, source_created_at,
          source_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversationId,
        persona.id,
        persona.name,
        persona.nameZhCn,
        persona.gender,
        persona.age,
        persona.occupation,
        persona.occupationZhCn,
        persona.background,
        persona.backgroundZhCn,
        JSON.stringify(persona.personalityTraits),
        JSON.stringify(persona.personalityTraitsZhCn),
        persona.communicationStyle,
        persona.communicationStyleZhCn,
        persona.behaviorNotes,
        persona.behaviorNotesZhCn,
        JSON.stringify(persona.motivations),
        JSON.stringify(persona.motivationsZhCn),
        JSON.stringify(persona.concerns),
        JSON.stringify(persona.concernsZhCn),
        persona.voice,
        persona.createdAt,
        persona.updatedAt,
      );
  }

  private insertScenarioSnapshot(
    conversationId: number,
    scenario: Scenario,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO scenario_snapshots (
          conversation_id, source_scenario_id, name, name_zh_cn,
          description, description_zh_cn, goals_json, goals_zh_cn_json,
          suggested_skill_focus_json, suggested_skill_focus_zh_cn_json,
          success_criteria_json, success_criteria_zh_cn_json,
          tone_style, tone_style_zh_cn, interrupt_frequency, speaking_pace,
          source_created_at, source_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversationId,
        scenario.id,
        scenario.name,
        scenario.nameZhCn,
        scenario.description,
        scenario.descriptionZhCn,
        JSON.stringify(scenario.goals),
        JSON.stringify(scenario.goalsZhCn),
        JSON.stringify(scenario.suggestedSkillFocus),
        JSON.stringify(scenario.suggestedSkillFocusZhCn),
        JSON.stringify(scenario.successCriteria),
        JSON.stringify(scenario.successCriteriaZhCn),
        scenario.toneStyle,
        scenario.toneStyleZhCn,
        scenario.voiceBehavior.interruptFrequency ?? null,
        scenario.voiceBehavior.speakingPace ?? null,
        scenario.createdAt,
        scenario.updatedAt,
      );

    const insertCriterion = this.connection.prepare(
      `INSERT INTO scenario_scoring_criteria (
        conversation_id, position, name, name_zh_cn, weight
      ) VALUES (?, ?, ?, ?, ?)`,
    );
    scenario.scoringCriteria.forEach((criterion, position) => {
      insertCriterion.run(
        conversationId,
        position,
        criterion.name,
        criterion.nameZhCn,
        criterion.weight,
      );
    });

    const insertPersona = this.connection.prepare(
      `INSERT INTO scenario_personas (
        conversation_id, position, persona_id
      ) VALUES (?, ?, ?)`,
    );
    scenario.allowedPersonaIds.forEach((personaId, position) => {
      insertPersona.run(conversationId, position, personaId);
    });
  }

  private requireSnapshots(conversationId: number): {
    persona: PersonaSnapshot;
    scenario: ScenarioSnapshot;
  } {
    const personaRow = this.connection
      .prepare(
        `SELECT * FROM persona_snapshots
         WHERE conversation_id = ?`,
      )
      .get(conversationId) as unknown as PersonaSnapshotRow | undefined;
    const scenarioRow = this.connection
      .prepare(
        `SELECT * FROM scenario_snapshots
         WHERE conversation_id = ?`,
      )
      .get(conversationId) as unknown as ScenarioSnapshotRow | undefined;
    if (!personaRow || !scenarioRow) {
      throw new Error(
        `Conversation "${conversationId}" is missing its immutable catalog snapshots.`,
      );
    }
    const criteria = this.connection
      .prepare(
        `SELECT position, name, name_zh_cn, weight
         FROM scenario_scoring_criteria
         WHERE conversation_id = ?
         ORDER BY position`,
      )
      .all(conversationId) as unknown as SnapshotScoringCriterionRow[];
    const personaRows = this.connection
      .prepare(
        `SELECT persona_id
         FROM scenario_personas
         WHERE conversation_id = ?
         ORDER BY position`,
      )
      .all(conversationId) as unknown as Array<{ persona_id: number }>;
    return {
      persona: mapPersonaSnapshotRow(personaRow),
      scenario: mapScenarioSnapshotRow(
        scenarioRow,
        criteria,
        personaRows.map(({ persona_id }) => persona_id),
      ),
    };
  }

  private get connection() {
    return this.database.raw;
  }

  private getSessionRow(id: number): ConversationSessionRow | undefined {
    return this.connection
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as unknown as ConversationSessionRow | undefined;
  }

  private requireConversation(id: number): ConversationDetail {
    const conversation = this.getConversation(id);
    if (!conversation) throw new ConversationNotFoundError(id);
    return conversation;
  }

  private listMessages(conversationId: number): ConversationMessage[] {
    const rows = this.connection
      .prepare(
        `SELECT *
         FROM messages
         WHERE conversation_id = ?
         ORDER BY position`,
      )
      .all(conversationId) as unknown as ConversationMessageRow[];
    return rows.map(mapConversationMessageRow);
  }

  private countAudioMessages(conversationId: number): number {
    const row = this.connection
      .prepare(
        `SELECT COUNT(message_audio.message_id) AS count
         FROM messages
         JOIN message_audio ON message_audio.message_id = messages.id
         WHERE messages.conversation_id = ?`,
      )
      .get(conversationId) as unknown as { count: number };
    return row.count;
  }

  private getFeedbackStatus(conversationId: number): string | null {
    const row = this.connection
      .prepare(
        `SELECT status
         FROM feedback_reports
         WHERE conversation_id = ?`,
      )
      .get(conversationId) as unknown as { status: string } | undefined;
    return row?.status ?? null;
  }

  private insertMessageAudio(
    messageId: number,
    audio: z.infer<typeof conversationMessageAudioSchema>,
    timestamp: string,
  ): void {
    const durationMs = Math.max(
      1,
      Math.round((audio.pcm.length / 2 / audio.sampleRate) * 1_000),
    );
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO message_audio (
           message_id, sample_rate, pcm, duration_ms, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(messageId, audio.sampleRate, audio.pcm, durationMs, timestamp);
  }

  private listRecentMessages(
    conversationId: number,
    maximumUserTurns: number,
  ): ConversationMessage[] {
    const rows = this.connection
      .prepare(
        `WITH recent_user_positions AS (
           SELECT position
           FROM messages
           WHERE conversation_id = ? AND role = 'user'
           ORDER BY position DESC
           LIMIT ?
         )
         SELECT *
         FROM messages
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

  private requireMessage(id: number): ConversationMessage {
    const row = this.connection
      .prepare("SELECT * FROM messages WHERE id = ?")
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
         FROM messages
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

function normalizeSnapshotTimestamps<T extends {
  createdAt: string;
  updatedAt: string;
}>(snapshot: T): T {
  return {
    ...snapshot,
    createdAt: normalizeDatabaseTimestamp(snapshot.createdAt),
    updatedAt: normalizeDatabaseTimestamp(snapshot.updatedAt),
  };
}

function mapConversationSummaryRow(
  row: ConversationSummaryRow,
): ConversationSummary {
  return conversationSummarySchema.parse({
    id: row.id,
    personaName: selectLocalizedValue(
      row.persona_name,
      row.persona_name_zh_cn,
      "en",
    ),
    personaNameZhCn: selectLocalizedValue(
      row.persona_name,
      row.persona_name_zh_cn,
      "zh",
    ),
    scenarioName: selectLocalizedValue(
      row.scenario_name,
      row.scenario_name_zh_cn,
      "en",
    ),
    scenarioNameZhCn: selectLocalizedValue(
      row.scenario_name,
      row.scenario_name_zh_cn,
      "zh",
    ),
    difficulty: row.difficulty,
    locale: row.locale,
    status: row.status,
    endedAt: row.ended_at,
    feedbackStatus: row.feedback_status,
    messageCount: row.message_count,
    audioMessageCount: row.audio_message_count,
    audioAvailable:
      row.message_count > 0 && row.audio_message_count === row.message_count,
    lastMessagePreview: row.last_message_text?.slice(0, 240) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapConversationDetail(
  row: ConversationSessionRow,
  persona: PersonaSnapshot,
  scenario: ScenarioSnapshot,
  messages: ConversationMessage[],
  audioMessageCount: number,
  feedbackStatus: string | null,
): ConversationDetail {
  return conversationDetailSchema.parse({
    id: row.id,
    personaName: selectLocalizedValue(persona.name, persona.nameZhCn, "en"),
    personaNameZhCn: selectLocalizedValue(
      persona.name,
      persona.nameZhCn,
      "zh",
    ),
    scenarioName: selectLocalizedValue(scenario.name, scenario.nameZhCn, "en"),
    scenarioNameZhCn: selectLocalizedValue(
      scenario.name,
      scenario.nameZhCn,
      "zh",
    ),
    difficulty: row.difficulty,
    locale: row.locale,
    status: row.status,
    endedAt: row.ended_at,
    feedbackStatus,
    messageCount: messages.length,
    audioMessageCount,
    audioAvailable:
      messages.length > 0 && audioMessageCount === messages.length,
    lastMessagePreview: messages.at(-1)?.text.slice(0, 240) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    persona,
    scenario,
    messages,
  });
}

function parseAudioSampleRate(value: number): 16_000 | 24_000 {
  if (value === 16_000 || value === 24_000) return value;
  throw new Error(`Unsupported stored PCM sample rate "${value}".`);
}

function mapPersonaSnapshotRow(row: PersonaSnapshotRow): PersonaSnapshot {
  return personaSnapshotSchema.parse({
    id: row.source_persona_id,
    name: row.name,
    nameZhCn: row.name_zh_cn,
    gender: row.gender,
    age: row.age,
    occupation: row.occupation,
    occupationZhCn: row.occupation_zh_cn,
    background: row.background,
    backgroundZhCn: row.background_zh_cn,
    personalityTraits: parseJsonList(row.personality_traits_json),
    personalityTraitsZhCn: parseJsonList(row.personality_traits_zh_cn_json),
    communicationStyle: row.communication_style,
    communicationStyleZhCn: row.communication_style_zh_cn,
    behaviorNotes: row.behavior_notes,
    behaviorNotesZhCn: row.behavior_notes_zh_cn,
    motivations: parseJsonList(row.motivations_json),
    motivationsZhCn: parseJsonList(row.motivations_zh_cn_json),
    concerns: parseJsonList(row.concerns_json),
    concernsZhCn: parseJsonList(row.concerns_zh_cn_json),
    voice: row.voice,
    createdAt: row.source_created_at,
    updatedAt: row.source_updated_at,
  });
}

function mapScenarioSnapshotRow(
  row: ScenarioSnapshotRow,
  criteria: readonly SnapshotScoringCriterionRow[],
  allowedPersonaIds: readonly number[],
): ScenarioSnapshot {
  return scenarioSnapshotSchema.parse({
    id: row.source_scenario_id,
    name: row.name,
    nameZhCn: row.name_zh_cn,
    description: row.description,
    descriptionZhCn: row.description_zh_cn,
    goals: parseJsonList(row.goals_json),
    goalsZhCn: parseJsonList(row.goals_zh_cn_json),
    suggestedSkillFocus: parseJsonList(row.suggested_skill_focus_json),
    suggestedSkillFocusZhCn: parseJsonList(
      row.suggested_skill_focus_zh_cn_json,
    ),
    successCriteria: parseJsonList(row.success_criteria_json),
    successCriteriaZhCn: parseJsonList(row.success_criteria_zh_cn_json),
    toneStyle: row.tone_style,
    toneStyleZhCn: row.tone_style_zh_cn,
    voiceBehavior: {
      interruptFrequency: row.interrupt_frequency ?? undefined,
      speakingPace: row.speaking_pace ?? undefined,
    },
    scoringCriteria: criteria.map((criterion) => ({
      name: criterion.name,
      nameZhCn: criterion.name_zh_cn,
      weight: criterion.weight,
    })),
    allowedPersonaIds,
    createdAt: row.source_created_at,
    updatedAt: row.source_updated_at,
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

function parseJsonList(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function selectLocalizedValue(
  english: string,
  chinese: string,
  locale: z.infer<typeof conversationLocaleSchema>,
): string {
  return locale === "zh" ? chinese || english : english || chinese;
}

function parseDifficulty(value: string): Difficulty {
  return createConversationSnapshotInputSchema.shape.difficulty.parse(value);
}

function parseLocale(value: string): z.infer<typeof conversationLocaleSchema> {
  return conversationLocaleSchema.parse(value);
}

function toDatabaseId(value: number | bigint): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`SQLite returned an invalid generated ID: ${String(value)}.`);
  }
  return id;
}
