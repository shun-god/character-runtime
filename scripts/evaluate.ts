import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { GeminiCognitionEngine } from "../src/cognition.js";
import { CharacterRuntime } from "../src/runtime.js";
import {
  characterSpecSchema,
  type RuntimeOutput,
} from "../src/schema.js";
import type { CharacterState } from "../src/state.js";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const eventsSchema = z.array(z.string().trim().min(1));

type EvaluationSuccess = {
  event: string;
  output: RuntimeOutput;
  state_after: CharacterState;
};

type EvaluationFailure = {
  event: string;
  error: string;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const characterSpec = characterSpecSchema.parse(
    JSON.parse(
      await readFile(
        new URL("../character-spec.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const events = eventsSchema.parse(
    JSON.parse(
      await readFile(new URL("../evaluation/events.json", import.meta.url), "utf8"),
    ),
  );
  const results: Array<EvaluationSuccess | EvaluationFailure> = [];

  for (const event of events) {
    const runtime = new CharacterRuntime(
      characterSpec,
      new GeminiCognitionEngine({ apiKey, model }),
    );

    try {
      const output = await runtime.processEvent(event);
      results.push({ event, output, state_after: runtime.getState() });
      console.log(`Evaluated: ${event}`);
    } catch (error) {
      const message = errorMessage(error).replaceAll(apiKey, "[REDACTED]");
      results.push({ event, error: message });
      console.error(`Failed: ${event}: ${message}`);
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
      {
        evaluated_at: evaluatedAt.toISOString(),
        model,
        results,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Saved evaluation results: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
