import type {
  BestEvaluationResult,
  RuntimeOutput,
} from "./schema.js";

export type GoldenComparison = {
  action_type_match: boolean;
  speech_exact_match: boolean;
  micro_reaction_exact_match: boolean;
};

export type GoldenReference = {
  golden_output: RuntimeOutput | null;
  golden_notes: string[] | null;
  comparison: GoldenComparison | null;
};

export function createGoldenReference(
  output: RuntimeOutput | null,
  golden: BestEvaluationResult | undefined,
): GoldenReference {
  if (!golden) {
    return {
      golden_output: null,
      golden_notes: null,
      comparison: null,
    };
  }

  return {
    golden_output: golden.output,
    golden_notes: [...golden.notes],
    comparison: output
      ? {
          action_type_match:
            output.action_intent.type === golden.output.action_intent.type,
          speech_exact_match: output.speech === golden.output.speech,
          micro_reaction_exact_match:
            output.micro_reaction === golden.output.micro_reaction,
        }
      : null,
  };
}
