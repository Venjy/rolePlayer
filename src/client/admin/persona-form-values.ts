import type { PersonaInput } from "../../shared/role-play-catalog";
import { cleanStringList } from "./admin-options";

/**
 * Ant Design may return undefined after a Select is cleared even when the
 * persisted domain uses empty strings/arrays for optional fields.
 */
export type PersonaFormValues = Omit<
  PersonaInput,
  | "occupation"
  | "background"
  | "behaviorNotes"
  | "personalityTraits"
  | "motivations"
  | "concerns"
> & {
  occupation?: string;
  background?: string;
  behaviorNotes?: string;
  personalityTraits?: string[];
  motivations?: string[];
  concerns?: string[];
  previewScenarioId?: string;
};

export function normalizePersonaFormValues(
  values: PersonaFormValues,
): PersonaInput {
  const input = { ...values };
  delete input.previewScenarioId;

  return {
    ...input,
    occupation: (input.occupation ?? "").trim(),
    background: (input.background ?? "").trim(),
    behaviorNotes: (input.behaviorNotes ?? "").trim(),
    personalityTraits: cleanStringList(input.personalityTraits),
    motivations: cleanStringList(input.motivations),
    concerns: cleanStringList(input.concerns),
  };
}
