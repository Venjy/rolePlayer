import type { ApplicationDatabase } from "../database/database";
import {
  formatDatabaseTimestamp,
  nextDatabaseTimestamp,
} from "../database/database-time";
import {
  conversationFeedbackSchema,
  type ConversationFeedback,
} from "../../shared/conversation-feedback";
import type { ConversationDetail } from "../../shared/conversation-history";
import {
  localizedList,
  localizedText,
} from "../../shared/role-play-localization";
import {
  FeedbackGenerationError,
  type ConversationFeedbackGenerator,
  type FeedbackGenerationInput,
  type GeneratedConversationFeedback,
  validateGeneratedFeedbackReferences,
} from "./conversation-feedback-generator";
import {
  ConversationNotFoundError,
  ConversationRepository,
} from "./conversation-repository";

export const FEEDBACK_PROMPT_VERSION = "sales-coach-v4-bilingual-learner-only";

interface FeedbackReportRow {
  conversation_id: number;
  status: string;
  locale: string;
  overall_assessment: string | null;
  overall_assessment_zh_cn: string | null;
  overall_score: number | null;
  model: string | null;
  prompt_version: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface PositionedTextRow {
  position: number;
  text: string;
  text_zh_cn: string;
}

interface CoachingTipRow {
  position: number;
  title: string;
  title_zh_cn: string;
  advice: string;
  advice_zh_cn: string;
}

interface CriterionScoreRow {
  criterion_position: number;
  name: string;
  name_zh_cn: string;
  weight: number;
  score: number;
  rationale: string;
  rationale_zh_cn: string;
}

interface FeedbackMomentRow {
  position: number;
  message_id: number;
  kind: string;
  title: string;
  title_zh_cn: string;
  assessment: string;
  assessment_zh_cn: string;
  suggested_approach: string;
  suggested_approach_zh_cn: string;
}

export class ConversationFeedbackNotFoundError extends Error {
  public constructor(public readonly conversationId: number) {
    super(`No feedback exists for conversation "${conversationId}".`);
    this.name = "ConversationFeedbackNotFoundError";
  }
}

/** Owns normalized feedback records and their generation state machine. */
export class ConversationFeedbackRepository {
  private readonly conversations: ConversationRepository;

  public constructor(private readonly database: ApplicationDatabase) {
    this.conversations = new ConversationRepository(database);
  }

  public ensurePending(conversation: ConversationDetail): ConversationFeedback {
    const timestamp = formatDatabaseTimestamp();
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO feedback_reports (
           conversation_id, status, locale, prompt_version, created_at, updated_at
         ) VALUES (?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        conversation.id,
        conversation.locale,
        FEEDBACK_PROMPT_VERSION,
        timestamp,
        timestamp,
      );
    const current = this.require(conversation.id);
    if (current.promptVersion === FEEDBACK_PROMPT_VERSION) return current;

    // A completed report belongs to the prompt contract that produced it.
    // Regenerate an older report only when it is opened, rather than eagerly
    // spending model quota on every historical conversation at startup.
    const upgradeTimestamp = nextDatabaseTimestamp(current.updatedAt);
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.clearChildren(conversation.id);
      this.connection
        .prepare(
          `UPDATE feedback_reports
           SET status = 'pending', locale = ?, overall_assessment = NULL,
               overall_assessment_zh_cn = NULL,
               overall_score = NULL, model = NULL, prompt_version = ?,
               error_code = NULL, error_message = NULL, updated_at = ?,
               completed_at = NULL
           WHERE conversation_id = ?`,
        )
        .run(
          conversation.locale,
          FEEDBACK_PROMPT_VERSION,
          upgradeTimestamp,
          conversation.id,
        );
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
    return this.require(conversation.id);
  }

  public get(conversationId: number): ConversationFeedback | null {
    const report = this.connection
      .prepare("SELECT * FROM feedback_reports WHERE conversation_id = ?")
      .get(conversationId) as unknown as FeedbackReportRow | undefined;
    if (!report) return null;

    const strengths = this.connection
      .prepare(
        `SELECT position, text, text_zh_cn FROM feedback_strengths
         WHERE conversation_id = ? ORDER BY position`,
      )
      .all(conversationId) as unknown as PositionedTextRow[];
    const improvementAreas = this.connection
      .prepare(
        `SELECT position, text, text_zh_cn FROM feedback_improvement_areas
         WHERE conversation_id = ? ORDER BY position`,
      )
      .all(conversationId) as unknown as PositionedTextRow[];
    const coachingTips = this.connection
      .prepare(
        `SELECT position, title, title_zh_cn, advice, advice_zh_cn
         FROM feedback_coaching_tips
         WHERE conversation_id = ? ORDER BY position`,
      )
      .all(conversationId) as unknown as CoachingTipRow[];
    const criterionScores = this.connection
      .prepare(
        `SELECT scores.criterion_position,
                criteria.name,
                criteria.name_zh_cn,
                criteria.weight,
                scores.score,
                scores.rationale,
                scores.rationale_zh_cn
         FROM feedback_criterion_scores AS scores
         JOIN scenario_scoring_criteria AS criteria
           ON criteria.conversation_id = scores.conversation_id
          AND criteria.position = scores.criterion_position
         WHERE scores.conversation_id = ?
         ORDER BY scores.criterion_position`,
      )
      .all(conversationId) as unknown as CriterionScoreRow[];
    const moments = this.connection
      .prepare(
        `SELECT position, message_id, kind, title, title_zh_cn,
                assessment, assessment_zh_cn,
                suggested_approach, suggested_approach_zh_cn
         FROM feedback_moments
         WHERE conversation_id = ? ORDER BY position`,
      )
      .all(conversationId) as unknown as FeedbackMomentRow[];

    return conversationFeedbackSchema.parse({
      conversationId: report.conversation_id,
      status: report.status,
      locale: report.locale,
      overallAssessment: report.overall_assessment,
      overallAssessmentZhCn: report.overall_assessment_zh_cn,
      overallScore: report.overall_score,
      model: report.model,
      promptVersion: report.prompt_version,
      errorCode: report.error_code,
      errorMessage: report.error_message,
      strengths: strengths.map((strength) => ({
        position: strength.position,
        text: strength.text,
        textZhCn: strength.text_zh_cn,
      })),
      improvementAreas: improvementAreas.map((area) => ({
        position: area.position,
        text: area.text,
        textZhCn: area.text_zh_cn,
      })),
      coachingTips: coachingTips.map((tip) => ({
        position: tip.position,
        title: tip.title,
        titleZhCn: tip.title_zh_cn,
        advice: tip.advice,
        adviceZhCn: tip.advice_zh_cn,
      })),
      criterionScores: criterionScores.map((score) => ({
        criterionPosition: score.criterion_position,
        name: score.name,
        nameZhCn: score.name_zh_cn,
        weight: score.weight,
        score: score.score,
        rationale: score.rationale,
        rationaleZhCn: score.rationale_zh_cn,
      })),
      moments: moments.map((moment) => ({
        position: moment.position,
        messageId: moment.message_id,
        kind: moment.kind,
        title: moment.title,
        titleZhCn: moment.title_zh_cn,
        assessment: moment.assessment,
        assessmentZhCn: moment.assessment_zh_cn,
        suggestedApproach: moment.suggested_approach,
        suggestedApproachZhCn: moment.suggested_approach_zh_cn,
      })),
      createdAt: report.created_at,
      updatedAt: report.updated_at,
      completedAt: report.completed_at,
    });
  }

  public require(conversationId: number): ConversationFeedback {
    const feedback = this.get(conversationId);
    if (!feedback) throw new ConversationFeedbackNotFoundError(conversationId);
    return feedback;
  }

  public claim(conversationId: number, model: string): boolean {
    const current = this.require(conversationId);
    if (current.status !== "pending") return false;
    const timestamp = nextDatabaseTimestamp(current.updatedAt);
    const result = this.connection
      .prepare(
        `UPDATE feedback_reports
         SET status = 'processing', model = ?, prompt_version = ?,
             error_code = NULL, error_message = NULL, updated_at = ?
         WHERE conversation_id = ? AND status = 'pending'`,
      )
      .run(model, FEEDBACK_PROMPT_VERSION, timestamp, conversationId);
    return result.changes === 1;
  }

  public retry(conversationId: number): ConversationFeedback {
    const current = this.require(conversationId);
    if (current.status === "processing") return current;
    if (current.status === "completed") return current;
    const timestamp = nextDatabaseTimestamp(current.updatedAt);
    this.connection
      .prepare(
        `UPDATE feedback_reports
         SET status = 'pending', model = NULL, prompt_version = ?,
             error_code = NULL, error_message = NULL, updated_at = ?,
             completed_at = NULL
         WHERE conversation_id = ?`,
      )
      .run(FEEDBACK_PROMPT_VERSION, timestamp, conversationId);
    return this.require(conversationId);
  }

  public recoverInterruptedJobs(): number[] {
    const timestamp = formatDatabaseTimestamp();
    // Repair the narrow crash window between marking a session ended and
    // creating its report. This also upgrades ended rows created externally.
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO feedback_reports (
           conversation_id, status, locale, prompt_version, created_at, updated_at
         )
         SELECT id, 'pending', locale, ?, COALESCE(ended_at, updated_at), ?
         FROM sessions
         WHERE status = 'ended'`,
      )
      .run(FEEDBACK_PROMPT_VERSION, timestamp);
    this.connection
      .prepare(
        `UPDATE feedback_reports
         SET status = 'pending', error_code = NULL, error_message = NULL,
             prompt_version = ?, updated_at = ?
         WHERE status = 'processing'`,
      )
      .run(FEEDBACK_PROMPT_VERSION, timestamp);
    const rows = this.connection
      .prepare(
        `SELECT conversation_id FROM feedback_reports
         WHERE status = 'pending' ORDER BY created_at`,
      )
      .all() as unknown as Array<{ conversation_id: number }>;
    return rows.map((row) => row.conversation_id);
  }

  public generationInput(conversationId: number): FeedbackGenerationInput {
    const conversation = this.conversations.getConversation(conversationId);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return {
      locale: conversation.locale,
      personaName: localizedText(
        conversation.persona.name,
        conversation.persona.nameZhCn,
        "en",
      ),
      personaNameZhCn: localizedText(
        conversation.persona.name,
        conversation.persona.nameZhCn,
        "zh",
      ),
      scenarioName: localizedText(
        conversation.scenario.name,
        conversation.scenario.nameZhCn,
        "en",
      ),
      scenarioNameZhCn: localizedText(
        conversation.scenario.name,
        conversation.scenario.nameZhCn,
        "zh",
      ),
      difficulty: conversation.difficulty,
      goals: localizedList(
        conversation.scenario.goals,
        conversation.scenario.goalsZhCn,
        "en",
      ),
      goalsZhCn: localizedList(
        conversation.scenario.goals,
        conversation.scenario.goalsZhCn,
        "zh",
      ),
      skillFocus: localizedList(
        conversation.scenario.suggestedSkillFocus,
        conversation.scenario.suggestedSkillFocusZhCn,
        "en",
      ),
      skillFocusZhCn: localizedList(
        conversation.scenario.suggestedSkillFocus,
        conversation.scenario.suggestedSkillFocusZhCn,
        "zh",
      ),
      criteria: conversation.scenario.scoringCriteria.map(
        (criterion, position) => ({
          position,
          name: localizedText(criterion.name, criterion.nameZhCn, "en"),
          nameZhCn: localizedText(criterion.name, criterion.nameZhCn, "zh"),
          weight: criterion.weight,
        }),
      ),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        interrupted: message.interrupted,
      })),
    };
  }

  public complete(
    conversationId: number,
    generated: GeneratedConversationFeedback,
    model: string,
  ): ConversationFeedback {
    const input = this.generationInput(conversationId);
    validateGeneratedFeedbackReferences(generated, input);
    const current = this.require(conversationId);
    const timestamp = nextDatabaseTimestamp(current.updatedAt);
    const overallScore = Math.round(
      generated.criterionScores.reduce((total, criterion) => {
        const expected = input.criteria[criterion.criterionPosition];
        return total + criterion.score * (expected?.weight ?? 0) / 100;
      }, 0),
    );

    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.clearChildren(conversationId);
      this.connection
        .prepare(
          `UPDATE feedback_reports
           SET status = 'completed', overall_assessment = ?,
               overall_assessment_zh_cn = ?, overall_score = ?,
               model = ?, error_code = NULL, error_message = NULL,
               updated_at = ?, completed_at = ?
           WHERE conversation_id = ?`,
        )
        .run(
          generated.overallAssessment,
          generated.overallAssessmentZhCn,
          overallScore,
          model,
          timestamp,
          timestamp,
          conversationId,
        );

      const insertText = (
        table: string,
        values: ReadonlyArray<{ text: string; textZhCn: string }>,
      ) => {
        const statement = this.connection.prepare(
          `INSERT INTO ${table} (conversation_id, position, text, text_zh_cn)
           VALUES (?, ?, ?, ?)`,
        );
        values.forEach((value, position) =>
          statement.run(conversationId, position, value.text, value.textZhCn),
        );
      };
      insertText("feedback_strengths", generated.strengths);
      insertText("feedback_improvement_areas", generated.improvementAreas);

      const insertTip = this.connection.prepare(
        `INSERT INTO feedback_coaching_tips
           (conversation_id, position, title, title_zh_cn, advice, advice_zh_cn)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      generated.coachingTips.forEach((tip, position) =>
        insertTip.run(
          conversationId,
          position,
          tip.title,
          tip.titleZhCn,
          tip.advice,
          tip.adviceZhCn,
        ),
      );

      const insertCriterion = this.connection.prepare(
        `INSERT INTO feedback_criterion_scores
           (conversation_id, criterion_position, score, rationale,
            rationale_zh_cn)
         VALUES (?, ?, ?, ?, ?)`,
      );
      generated.criterionScores.forEach((criterion) =>
        insertCriterion.run(
          conversationId,
          criterion.criterionPosition,
          criterion.score,
          criterion.rationale,
          criterion.rationaleZhCn,
        ),
      );

      const insertMoment = this.connection.prepare(
        `INSERT INTO feedback_moments
           (conversation_id, position, message_id, kind, title,
            title_zh_cn, assessment, assessment_zh_cn,
            suggested_approach, suggested_approach_zh_cn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      generated.moments.forEach((moment, position) =>
        insertMoment.run(
          conversationId,
          position,
          moment.messageId,
          moment.kind,
          moment.title,
          moment.titleZhCn,
          moment.assessment,
          moment.assessmentZhCn,
          moment.suggestedApproach,
          moment.suggestedApproachZhCn,
        ),
      );
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
    return this.require(conversationId);
  }

  public fail(
    conversationId: number,
    code: string,
    message: string,
    model: string,
  ): ConversationFeedback {
    const current = this.require(conversationId);
    const timestamp = nextDatabaseTimestamp(current.updatedAt);
    this.connection
      .prepare(
        `UPDATE feedback_reports
         SET status = 'failed', model = ?, error_code = ?, error_message = ?,
             updated_at = ?, completed_at = NULL
         WHERE conversation_id = ?`,
      )
      .run(
        model,
        code.slice(0, 100),
        message.slice(0, 2_000),
        timestamp,
        conversationId,
      );
    return this.require(conversationId);
  }

  private clearChildren(conversationId: number): void {
    for (const table of [
      "feedback_strengths",
      "feedback_improvement_areas",
      "feedback_coaching_tips",
      "feedback_criterion_scores",
      "feedback_moments",
    ]) {
      this.connection
        .prepare(`DELETE FROM ${table} WHERE conversation_id = ?`)
        .run(conversationId);
    }
  }

  private get connection() {
    return this.database.raw;
  }
}

/** Prevents duplicate in-process jobs while keeping durable retry state in SQLite. */
export class ConversationFeedbackService {
  private readonly inFlight = new Map<number, Promise<void>>();
  private readonly jobControllers = new Map<number, AbortController>();
  private readonly shutdown = new AbortController();

  public constructor(
    private readonly repository: ConversationFeedbackRepository,
    private readonly generator: ConversationFeedbackGenerator,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  public trigger(conversationId: number): void {
    if (this.shutdown.signal.aborted) return;
    if (this.inFlight.has(conversationId)) return;
    const controller = new AbortController();
    this.jobControllers.set(conversationId, controller);
    const signal = AbortSignal.any([
      this.shutdown.signal,
      controller.signal,
    ]);
    const task = this.run(conversationId, signal)
      .catch((error: unknown) => this.onError(error))
      .finally(() => {
        this.inFlight.delete(conversationId);
        this.jobControllers.delete(conversationId);
      });
    this.inFlight.set(conversationId, task);
  }

  public retry(conversationId: number): ConversationFeedback {
    const feedback = this.repository.retry(conversationId);
    if (feedback.status === "pending") this.trigger(conversationId);
    return feedback;
  }

  public resumePending(): void {
    for (const conversationId of this.repository.recoverInterruptedJobs()) {
      this.trigger(conversationId);
    }
  }

  /** Stops an in-process model request before its conversation is deleted. */
  public async cancel(conversationId: number): Promise<void> {
    this.jobControllers.get(conversationId)?.abort();
    const task = this.inFlight.get(conversationId);
    if (task) await task;
  }

  public async close(): Promise<void> {
    this.shutdown.abort();
    for (const controller of this.jobControllers.values()) controller.abort();
    await Promise.allSettled(this.inFlight.values());
  }

  private async run(conversationId: number, signal: AbortSignal): Promise<void> {
    if (!this.repository.claim(conversationId, this.generator.model)) return;
    try {
      let input: FeedbackGenerationInput;
      try {
        input = this.repository.generationInput(conversationId);
      } catch (error) {
        throw new FeedbackGenerationError(
          error instanceof Error
            ? `The conversation evidence could not be loaded: ${error.message}`
            : "The conversation evidence could not be loaded.",
          "feedback_data_unavailable",
        );
      }
      if (!input.messages.some((message) => message.role === "user")) {
        throw new FeedbackGenerationError(
          "The conversation has no user speech to evaluate.",
          "feedback_insufficient_conversation",
        );
      }
      const generated = await this.generator.generate(input, signal);
      try {
        this.repository.complete(conversationId, generated, this.generator.model);
      } catch (error) {
        throw new FeedbackGenerationError(
          error instanceof Error
            ? `The generated feedback could not be saved: ${error.message}`
            : "The generated feedback could not be saved.",
          "feedback_persistence_failed",
        );
      }
    } catch (error) {
      // Keep a shutdown-interrupted row as processing. Startup recovery resets
      // it to pending before starting a replacement request.
      if (signal.aborted) return;
      const normalized = normalizeGenerationError(error);
      this.repository.fail(
        conversationId,
        normalized.code,
        normalized.message,
        this.generator.model,
      );
    }
  }
}

function normalizeGenerationError(error: unknown): FeedbackGenerationError {
  if (error instanceof FeedbackGenerationError) return error;
  return new FeedbackGenerationError(
    error instanceof Error
      ? `An unexpected feedback-generation error occurred: ${error.message}`
      : "An unexpected feedback-generation error occurred.",
    "feedback_generation_failed",
  );
}
