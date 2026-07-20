import type { DatabaseSync } from "node:sqlite";

/**
 * Keeps success criteria independently selectable while making their numeric
 * weights optional. A NULL weight means the criterion can guide the role play
 * and completion detector but must not produce a score in the feedback report.
 */
export function makeScenarioScoringWeightsOptional(
  database: DatabaseSync,
): void {
  database.exec(`
    ALTER TABLE scenario_success_criteria
      RENAME TO scenario_success_criteria_before_optional_scoring;

    CREATE TABLE scenario_success_criteria (
      scenario_id INTEGER NOT NULL,
      success_criterion_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      weight INTEGER CHECK (weight IS NULL OR weight BETWEEN 0 AND 100),
      PRIMARY KEY (scenario_id, success_criterion_preset_id),
      UNIQUE (scenario_id, position),
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
      FOREIGN KEY (success_criterion_preset_id)
        REFERENCES scenario_success_criterion_presets(id) ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO scenario_success_criteria (
      scenario_id, success_criterion_preset_id, position, weight
    )
    SELECT scenario_id, success_criterion_preset_id, position, weight
    FROM scenario_success_criteria_before_optional_scoring;

    DROP TABLE scenario_success_criteria_before_optional_scoring;
  `);
}
