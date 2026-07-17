import { readFile, stat } from "node:fs/promises";

import type { z } from "zod";

import {
  resolveCharacterPackageLocation,
  type CharacterPackageLocation,
} from "./character-selection.js";

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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function ensureCharacterPackageDirectory(
  location: CharacterPackageLocation,
): Promise<void> {
  try {
    const directory = await stat(
      new URL(`../${location.directory}/`, import.meta.url),
    );
    if (directory.isDirectory()) {
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  throw new Error(
    `Character package "${location.id}" was not found: ${location.directory}`,
  );
}

async function readCharacterPackageJson(
  location: CharacterPackageLocation,
  relativePath: string,
): Promise<unknown> {
  try {
    return await readJson(new URL(`../${relativePath}`, import.meta.url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Character package "${location.id}" is missing required file: ${relativePath}`,
        { cause: error },
      );
    }
    if (error instanceof SyntaxError) {
      throw new Error(
        `Character package "${location.id}" has invalid JSON in ${relativePath}: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function parseCharacterPackageFile<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  location: CharacterPackageLocation,
  relativePath: string,
): z.infer<T> {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new Error(
      `Character package "${location.id}" failed validation for ${relativePath}: ${errorMessage(error)}`,
      { cause: error },
    );
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
  options: { characterId: string },
): Promise<CognitionResources> {
  const characterLocation = resolveCharacterPackageLocation(options.characterId);
  await ensureCharacterPackageDirectory(characterLocation);
  const [
    interactionPolicyJson,
    characterSpecJson,
    characterPrinciplesJson,
    bestEvaluationJson,
  ] = await Promise.all([
      readJson(new URL("../interaction-policy.json", import.meta.url)),
      readCharacterPackageJson(characterLocation, characterLocation.specPath),
      readCharacterPackageJson(
        characterLocation,
        characterLocation.principlesPath,
      ),
      readCharacterPackageJson(
        characterLocation,
        characterLocation.goldenEvaluationPath,
      ),
    ]);

  const interactionPolicy = interactionPolicySchema.parse(interactionPolicyJson);
  const characterSpec = parseCharacterPackageFile(
    characterSpecSchema,
    characterSpecJson,
    characterLocation,
    characterLocation.specPath,
  );
  const characterPrinciples = parseCharacterPackageFile(
    characterPrinciplesSchema,
    characterPrinciplesJson,
    characterLocation,
    characterLocation.principlesPath,
  );
  const bestEvaluation = parseCharacterPackageFile(
    bestEvaluationSchema,
    bestEvaluationJson,
    characterLocation,
    characterLocation.goldenEvaluationPath,
  );

  try {
    return createCognitionResources(
      interactionPolicy,
      characterSpec,
      characterPrinciples,
      bestEvaluation,
    );
  } catch (error) {
    throw new Error(
      `Character package "${characterLocation.id}" could not select required few-shot examples: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}
