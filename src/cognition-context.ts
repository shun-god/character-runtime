import { readFile } from "node:fs/promises";

import {
  bestEvaluationSchema,
  characterPrinciplesSchema,
  characterSpecSchema,
  interactionPolicySchema,
  type BestEvaluation,
  type BestEvaluationResult,
  type CharacterPrinciples,
  type CharacterSpec,
  type InteractionPolicy,
} from "./schema.js";

export const FEW_SHOT_EVENTS = [
  "user said hello",
  "user said they failed an exam",
  "user asked for a drink",
  "user criticized the character",
  "user said they want to try something difficult",
] as const;

export type CharacterPackageLocation = {
  id: string;
  directory: string;
};

export const CURRENT_CHARACTER_PACKAGE: CharacterPackageLocation = {
  id: "hiro",
  directory: "characters/hiro",
};

export type CharacterPackage = {
  spec: CharacterSpec;
  principles: CharacterPrinciples;
  goldenEvaluation: BestEvaluation;
};

export type CognitionResources = {
  interactionPolicy: InteractionPolicy;
  characterPackage: CharacterPackage;
  fewShotExamples: BestEvaluationResult[];
};

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, "utf8"));
}

async function readCharacterPackageJson(
  location: CharacterPackageLocation,
  fileName: string,
): Promise<unknown> {
  const relativePath = `${location.directory}/${fileName}`;
  try {
    return await readJson(new URL(`../${relativePath}`, import.meta.url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Character package "${location.id}" is missing: ${relativePath}`,
        { cause: error },
      );
    }
    throw error;
  }
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

export function createCognitionResources(
  interactionPolicy: InteractionPolicy,
  characterSpec: CharacterSpec,
  characterPrinciples: CharacterPrinciples,
  bestEvaluation: BestEvaluation,
): CognitionResources {
  return {
    interactionPolicy,
    characterPackage: {
      spec: characterSpec,
      principles: characterPrinciples,
      goldenEvaluation: bestEvaluation,
    },
    fewShotExamples: selectFewShotExamples(bestEvaluation),
  };
}

export async function loadCognitionResources(
  characterLocation = CURRENT_CHARACTER_PACKAGE,
): Promise<CognitionResources> {
  const [
    interactionPolicyJson,
    characterSpecJson,
    characterPrinciplesJson,
    bestEvaluationJson,
  ] = await Promise.all([
      readJson(new URL("../interaction-policy.json", import.meta.url)),
      readCharacterPackageJson(characterLocation, "character-spec.json"),
      readCharacterPackageJson(characterLocation, "character-principles.json"),
      readCharacterPackageJson(characterLocation, "best-evaluation.json"),
    ]);

  const interactionPolicy = interactionPolicySchema.parse(interactionPolicyJson);
  const characterSpec = characterSpecSchema.parse(characterSpecJson);
  const characterPrinciples = characterPrinciplesSchema.parse(
    characterPrinciplesJson,
  );
  const bestEvaluation = bestEvaluationSchema.parse(bestEvaluationJson);

  return createCognitionResources(
    interactionPolicy,
    characterSpec,
    characterPrinciples,
    bestEvaluation,
  );
}
