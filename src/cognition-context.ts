import { readFile } from "node:fs/promises";

import {
  bestEvaluationSchema,
  characterSpecSchema,
  responsePrinciplesSchema,
  type BestEvaluation,
  type BestEvaluationResult,
  type CharacterSpec,
  type ResponsePrinciples,
} from "./schema.js";

export const FEW_SHOT_EVENTS = [
  "user said hello",
  "user said they failed an exam",
  "user asked for a drink",
  "user criticized the character",
  "user said they want to try something difficult",
] as const;

type CognitionResources = {
  characterSpec: CharacterSpec;
  responsePrinciples: ResponsePrinciples;
  bestEvaluation: BestEvaluation;
  fewShotExamples: BestEvaluationResult[];
};

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, "utf8"));
}

export function selectFewShotExamples(
  bestEvaluation: BestEvaluation,
): BestEvaluationResult[] {
  return FEW_SHOT_EVENTS.map((event) => {
    const example = bestEvaluation.results.find((result) => result.event === event);
    if (!example) {
      throw new Error(`Required few-shot event is missing: ${event}`);
    }
    return example;
  });
}

export async function loadCognitionResources(): Promise<CognitionResources> {
  const [characterSpecJson, responsePrinciplesJson, bestEvaluationJson] =
    await Promise.all([
      readJson(new URL("../character-spec.json", import.meta.url)),
      readJson(new URL("../response-principles.json", import.meta.url)),
      readJson(new URL("../best-evaluation.json", import.meta.url)),
    ]);

  const characterSpec = characterSpecSchema.parse(characterSpecJson);
  const responsePrinciples = responsePrinciplesSchema.parse(
    responsePrinciplesJson,
  );
  const bestEvaluation = bestEvaluationSchema.parse(bestEvaluationJson);

  return {
    characterSpec,
    responsePrinciples,
    bestEvaluation,
    fewShotExamples: selectFewShotExamples(bestEvaluation),
  };
}
