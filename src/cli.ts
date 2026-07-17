import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { GeminiCognitionEngine } from "./cognition.js";
import { CharacterRuntime } from "./runtime.js";
import { characterSpecSchema, type RuntimeOutput } from "./schema.js";

function printResult(result: RuntimeOutput): void {
  console.log(`\nevent_summary:\n${result.event_summary}`);
  console.log("\nstate_effect:");
  console.log(`energy: ${result.state_effect.energy >= 0 ? "+" : ""}${result.state_effect.energy}`);
  console.log(`affinity: ${result.state_effect.affinity >= 0 ? "+" : ""}${result.state_effect.affinity}`);
  console.log(`mood: ${result.state_effect.mood}`);
  console.log(`\naction_intent:\ntype: ${result.action_intent.type}`);
  console.log(`\nspeech:\n${result.speech ?? "(none)"}`);
  console.log(`\nmicro_reaction:\n${result.micro_reaction ?? "(none)"}\n`);
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const specUrl = new URL("../character-spec.json", import.meta.url);
  const characterSpec = characterSpecSchema.parse(
    JSON.parse(await readFile(specUrl, "utf8")),
  );
  const engine = new GeminiCognitionEngine({
    apiKey,
    model: process.env.GEMINI_MODEL,
  });
  const runtime = new CharacterRuntime(characterSpec, engine);
  const cli = createInterface({ input, output });

  console.log("Character Runtime v0.1 (type 'exit' to quit)");

  try {
    while (true) {
      const line = (await cli.question("> event: ")).trim();
      if (line.toLowerCase() === "exit") {
        break;
      }
      if (!line) {
        console.error("Event must not be empty.\n");
        continue;
      }

      try {
        printResult(await runtime.processEvent(line));
        console.log("current_state:");
        console.log(JSON.stringify(runtime.getState(), null, 2));
        console.log();
      } catch (error) {
        console.error(
          `Failed to process event: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  } finally {
    cli.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
