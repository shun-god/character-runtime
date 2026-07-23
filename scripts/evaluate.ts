import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { resolveCharacterId } from "../src/character-selection.js";
import { GeminiCognitionEngine } from "../src/cognition.js";
import { loadCognitionResources } from "../src/cognition-context.js";
import { evaluationCasesSchema } from "../src/evaluation-case.js";
import type { RuntimeEvent } from "../src/event.js";
import {
  createCognitionEvaluationFields,
  createEvaluationReport,
  getEvaluationExitCode,
  type CognitionDiagnostics,
} from "../src/evaluation-report.js";
import {
  createGoldenReference,
  type GoldenReference,
} from "../src/golden-comparison.js";
import { CharacterRuntime } from "../src/runtime.js";
import type { RuntimeOutput } from "../src/schema.js";
import type { CharacterState } from "../src/state.js";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

type EvaluationSuccess = {
  name: string;
  event: RuntimeEvent;
  cognition: CognitionDiagnostics;
  output: RuntimeOutput;
  state_after: CharacterState;
} & GoldenReference;

type EvaluationFailure = {
  name: string;
  event: RuntimeEvent;
  cognition: null;
  error: string;
} & GoldenReference;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const characterId = resolveCharacterId(process.argv.slice(2));
  const {
    interactionPolicy,
    characterPackage,
    fewShotExamples,
  } = await loadCognitionResources({ characterId });
  const bestEvaluation = characterPackage.goldenEvaluation;
  const events = evaluationCasesSchema.parse(
    JSON.parse(
      await readFile(new URL("../evaluation/events.json", import.meta.url), "utf8"),
    ),
  );
  const eventSet = new Set(events.map(({ name }) => name));
  const missingGoldenEvents = bestEvaluation.results
    .map((result) => result.event)
    .filter((event) => !eventSet.has(event));
  if (missingGoldenEvents.length > 0) {
    throw new Error(
      `Evaluation events are missing Golden events: ${missingGoldenEvents.join(", ")}`,
    );
  }

  const results: Array<EvaluationSuccess | EvaluationFailure> = [];

  for (const evaluationCase of events) {
    const { name, event } = evaluationCase;
    const golden = bestEvaluation.results.find((result) => result.event === name);
    const cognitionEngine = new GeminiCognitionEngine({
      apiKey,
      characterId,
      model,
      interactionPolicy,
      characterPrinciples: characterPackage.principles,
      fewShotExamples,
      reactionPresets: characterPackage.reactionPresets,
    });
    const runtime = new CharacterRuntime(
      characterPackage.spec,
      cognitionEngine,
    );

    try {
      const output = await runtime.processEvent(event);
      const cognitionOutput = cognitionEngine.getLastCognitionOutput();
      if (!cognitionOutput) {
        throw new Error("Cognition diagnostics were not available after processing.");
      }
      const cognitionFields = createCognitionEvaluationFields(cognitionOutput);
      results.push({
        name,
        event,
        ...cognitionFields,
        state_after: runtime.getState(),
        ...createGoldenReference(output, golden),
      });
      console.log(`Evaluated: ${name}`);
    } catch (error) {
      const message = errorMessage(error).replaceAll(apiKey, "[REDACTED]");
      results.push({
        name,
        event,
        cognition: null,
        error: message,
        ...createGoldenReference(null, golden),
      });
      console.error(`Failed: ${name}: ${message}`);
    }
  }

  const evaluatedAt = new Date();
  const timestamp = evaluatedAt.toISOString().replace(/[:.]/g, "-");
  const resultsDirectory = fileURLToPath(
    new URL("../evaluation/results/", import.meta.url),
  );
  const outputPath = fileURLToPath(
    new URL(
      `../evaluation/results/evaluation-${timestamp}.json`,
      import.meta.url,
    ),
  );

  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      createEvaluationReport({ evaluatedAt, model, characterId, results }),
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Saved evaluation results: ${outputPath}`);
  process.exitCode = getEvaluationExitCode(results);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
