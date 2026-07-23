import type { CognitionOutputWithReferenceWarnings } from "./character-references.js";

export type CognitionDiagnostics = Pick<
  CognitionOutputWithReferenceWarnings,
  "perception" | "character_references" | "response_plan" | "reference_warnings"
>;

export function createCognitionEvaluationFields(
  cognitionOutput: CognitionOutputWithReferenceWarnings,
) {
  return {
    cognition: {
      perception: cognitionOutput.perception,
      character_references: cognitionOutput.character_references,
      response_plan: cognitionOutput.response_plan,
      reference_warnings: cognitionOutput.reference_warnings,
    },
    output: cognitionOutput.runtime_output,
  };
}

export function getEvaluationExitCode(
  results: readonly object[],
): 0 | 1 {
  return results.some((result) => "error" in result) ? 1 : 0;
}

export function createEvaluationReport<T>(options: {
  evaluatedAt: Date;
  model: string;
  characterId: string;
  results: T[];
}) {
  return {
    evaluated_at: options.evaluatedAt.toISOString(),
    model: options.model,
    character_id: options.characterId,
    results: options.results,
  };
}
