import type { CognitionOutput } from "./schema.js";

export type CognitionDiagnostics = Pick<
  CognitionOutput,
  "perception" | "response_plan"
>;

export function createCognitionEvaluationFields(
  cognitionOutput: CognitionOutput,
) {
  return {
    cognition: {
      perception: cognitionOutput.perception,
      response_plan: cognitionOutput.response_plan,
    },
    output: cognitionOutput.runtime_output,
  };
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
