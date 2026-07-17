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
