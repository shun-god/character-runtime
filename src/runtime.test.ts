import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_CHARACTER_ID,
  resolveCharacterId,
  resolveCharacterPackageLocation,
  validateCharacterId,
} from "./character-selection.js";
import {
  createCharacterReferenceCandidates,
  extractCharacterSpecReferenceCandidates,
  validateCharacterReferences,
  type CognitionOutputWithReferenceWarnings,
} from "./character-references.js";
import {
  parseGeminiCognitionOutput,
  type CognitionEngine,
  type CognitionInput,
} from "./cognition.js";
import {
  createCognitionResources,
  FEW_SHOT_EVENTS,
  loadCognitionResources,
  selectFewShotExamples,
} from "./cognition-context.js";
import { createGoldenReference } from "./golden-comparison.js";
import {
  createCognitionEvaluationFields,
  createEvaluationReport,
} from "./evaluation-report.js";
import { evaluationCasesSchema } from "./evaluation-case.js";
import {
  createUserMessageEvent,
  getEventTimeContext,
  runtimeEventSchema,
  type RuntimeEvent,
} from "./event.js";
import { RecentMemory } from "./memory.js";
import { CharacterRuntime } from "./runtime.js";
import {
  bestEvaluationSchema,
  characterPrinciplesSchema,
  characterSpecSchema,
  cognitionOutputSchema,
  interactionPolicySchema,
  reactionPresetsSchema,
  type CharacterSpec,
  type CognitionOutput,
  type RuntimeOutput,
} from "./schema.js";

const spec: CharacterSpec = {
  identity: {
    name: "篠澤広",
    role: "companion",
    first_person: "わたし",
    user_address: "プロデューサー",
  },
  personality: ["observant"],
  values: ["well-being"],
  relationship: {
    user_role: "producer",
    traits: ["equal relationship"],
  },
  speech_style: {
    language: "Japanese",
    tone: "soft",
    guidelines: ["avoid excessive formality"],
  },
  behavior_preferences: ["prefer waiting when uncertain"],
  background: ["graduated early"],
};

const characterPrinciples = characterPrinciplesSchema.parse({
  principles: ["失敗した場合は静かに支える", "称賛を素直に喜ぶ"],
});

const reactionPresets = reactionPresetsSchema.parse({
  presets: [
    {
      id: "greeting.default",
      description: "標準の挨拶",
      action_intent: { type: "respond" },
      speech: "登録済みの挨拶です。",
      micro_reaction: "小さく微笑む",
    },
    {
      id: "silence.wait",
      description: "静かに待つ",
      action_intent: { type: "wait" },
      speech: null,
      micro_reaction: null,
    },
  ],
});

const returnedHomeEvent: RuntimeEvent = runtimeEventSchema.parse({
  type: "system.observation",
  source: "system",
  occurred_at: "2026-07-17T19:30:00+09:00",
  payload: { name: "user_returned_home", data: {} },
});

const messageEvent = createUserMessageEvent(
  "ただいま",
  "2026-07-17T05:30:00+09:00",
);

const output: RuntimeOutput = {
  event_summary: "ユーザーが帰宅した。",
  state_effect: { energy: -2, affinity: 1, mood: "concerned" },
  action_intent: { type: "respond" },
  speech: "おかえり、プロデューサー。",
  micro_reaction: "小さく微笑む",
};

const waitOutput: RuntimeOutput = {
  event_summary: "ユーザーがしばらく発話していない。",
  state_effect: { energy: 0, affinity: 0, mood: "calm" },
  action_intent: { type: "wait" },
  speech: null,
  micro_reaction: null,
};

const reactionOutput: RuntimeOutput = {
  event_summary: "ユーザーがこちらを見ている。",
  state_effect: { energy: 0, affinity: 0, mood: "calm" },
  action_intent: { type: "show_reaction" },
  speech: null,
  micro_reaction: "少し首を傾げる",
};

const cognitionOutput: CognitionOutput = {
  perception: {
    known_facts: ["ユーザーが帰宅した"],
    unknowns: [],
  },
  character_references: {
    spec_items: ["observant"],
    principles: ["失敗した場合は静かに支える"],
  },
  response_plan: {
    stance: "簡潔に出迎える",
    should_advise: false,
    should_ask_question: false,
    response_length: "short",
    response_mode: "generated",
    preset_id: null,
  },
  runtime_output: output,
};

const waitCognitionOutput: CognitionOutput = {
  perception: {
    known_facts: ["ユーザーがしばらく発話していない"],
    unknowns: ["沈黙の理由"],
  },
  character_references: { spec_items: [], principles: [] },
  response_plan: {
    stance: "静かに待つ",
    should_advise: false,
    should_ask_question: false,
    response_length: "none",
    response_mode: "silent",
    preset_id: null,
  },
  runtime_output: waitOutput,
};

const reactionCognitionOutput: CognitionOutput = {
  perception: {
    known_facts: ["ユーザーがこちらを見ている"],
    unknowns: [],
  },
  character_references: { spec_items: [], principles: [] },
  response_plan: {
    stance: "画面上で小さく反応する",
    should_advise: false,
    should_ask_question: false,
    response_length: "none",
    response_mode: "silent",
    preset_id: null,
  },
  runtime_output: reactionOutput,
};

const validatedCognitionOutput: CognitionOutputWithReferenceWarnings = {
  ...cognitionOutput,
  reference_warnings: [],
};

const parseOptions = {
  characterId: "hiro",
  characterSpec: spec,
  characterPrinciples,
  reactionPresets: { presets: [] },
};

const parseTestCognitionOutput = (
  text: string | undefined,
): CognitionOutputWithReferenceWarnings =>
  parseGeminiCognitionOutput(text, parseOptions);

class StubEngine implements CognitionEngine {
  readonly inputs: CognitionInput[] = [];

  async process(input: CognitionInput): Promise<RuntimeOutput> {
    this.inputs.push(input);
    return output;
  }
}

class InvalidOutputEngine implements CognitionEngine {
  async process(): Promise<RuntimeOutput> {
    return parseTestCognitionOutput(
      JSON.stringify({
        ...cognitionOutput,
        runtime_output: { ...output, speech: null },
      }),
    ).runtime_output;
  }
}

test("validates user messages and system observations", () => {
  assert.deepEqual(
    runtimeEventSchema.parse(messageEvent),
    messageEvent,
  );
  assert.deepEqual(
    runtimeEventSchema.parse(returnedHomeEvent),
    returnedHomeEvent,
  );
  assert.deepEqual(messageEvent, {
    type: "user.message",
    source: "user",
    occurred_at: "2026-07-17T05:30:00+09:00",
    payload: { text: "ただいま" },
  });
});

test("rejects invalid Event variants and timestamps", () => {
  const validMessage = {
    type: "user.message",
    source: "user",
    occurred_at: "2026-07-17T20:10:00+09:00",
    payload: { text: "hello" },
  };
  for (const invalidEvent of [
    { ...validMessage, source: "system" },
    { ...validMessage, payload: { text: "   " } },
    { ...validMessage, occurred_at: "2026-07-17T20:10:00" },
    { ...validMessage, occurred_at: "2026-02-30T20:10:00+09:00" },
    { ...validMessage, occurred_at: "2026-07-17T25:10:00+09:00" },
    { ...validMessage, occurred_at: "2026-07-17T20:10:00+99:99" },
    { ...validMessage, occurred_at: "2026-07-17T20:10:00+24:00" },
    { ...validMessage, occurred_at: "2026-07-17T20:10:00+09:60" },
    { ...validMessage, type: "unknown.event" },
    {
      ...validMessage,
      payload: { name: "user_returned_home", data: {} },
    },
    {
      type: "system.observation",
      source: "user",
      occurred_at: validMessage.occurred_at,
      payload: { name: "user_returned_home", data: {} },
    },
    {
      type: "system.observation",
      source: "system",
      occurred_at: validMessage.occurred_at,
      payload: { name: "   ", data: {} },
    },
    {
      type: "system.observation",
      source: "system",
      occurred_at: validMessage.occurred_at,
      payload: { text: "ただいま" },
    },
  ]) {
    assert.equal(runtimeEventSchema.safeParse(invalidEvent).success, false);
  }

  assert.equal(
    runtimeEventSchema.safeParse({
      type: "system.observation",
      source: "system",
      occurred_at: "2026-07-17T20:10:00-05:00",
      payload: {
        name: "nested_observation",
        data: { nested: { count: 1 }, values: [true, null] },
      },
    }).success,
    true,
  );
});

test("derives time of day from the Event offset wall clock", () => {
  const cases = [
    ["2026-07-17T04:59:00+09:00", "night"],
    ["2026-07-17T05:00:00+09:00", "morning"],
    ["2026-07-17T11:59:00+09:00", "morning"],
    ["2026-07-17T12:00:00+09:00", "daytime"],
    ["2026-07-17T16:59:00+09:00", "daytime"],
    ["2026-07-17T17:00:00+09:00", "evening"],
    ["2026-07-17T21:59:00+09:00", "evening"],
    ["2026-07-17T22:00:00+09:00", "night"],
  ] as const;

  for (const [occurredAt, expected] of cases) {
    const event = createUserMessageEvent("test", occurredAt);
    assert.equal(getEventTimeContext(event).time_of_day, expected);
  }
  assert.equal(
    getEventTimeContext(
      createUserMessageEvent("test", "2026-07-17T20:00:00-05:00"),
    ).utc_offset,
    "-05:00",
  );
  assert.deepEqual(
    getEventTimeContext(
      createUserMessageEvent("test", "2026-07-18T01:00:00Z"),
    ),
    {
      occurred_at: "2026-07-18T01:00:00Z",
      time_of_day: "night",
      utc_offset: "Z",
    },
  );
});

test("resolves Character ID from argument, environment, and default", () => {
  const originalCharacterId = process.env.CHARACTER_ID;
  try {
    delete process.env.CHARACTER_ID;
    assert.equal(resolveCharacterId([], process.env), DEFAULT_CHARACTER_ID);

    process.env.CHARACTER_ID = "environment-character";
    assert.equal(resolveCharacterId([], process.env), "environment-character");
    assert.equal(
      resolveCharacterId(["--character", "argument-character"], process.env),
      "argument-character",
    );
    assert.equal(
      resolveCharacterId(["--character=inline-character"], process.env),
      "inline-character",
    );
  } finally {
    if (originalCharacterId === undefined) {
      delete process.env.CHARACTER_ID;
    } else {
      process.env.CHARACTER_ID = originalCharacterId;
    }
  }
});

test("validates Character IDs and resolves all package paths", () => {
  for (const id of ["hiro", "test-character", "character_01"]) {
    assert.equal(validateCharacterId(id), id);
  }
  for (const id of ["../hiro", "/hiro", "hiro/other", "", "has space", "C:\\hiro"]) {
    assert.throws(() => validateCharacterId(id), /Invalid character ID/);
  }

  assert.deepEqual(resolveCharacterPackageLocation("hiro"), {
    id: "hiro",
    directory: "characters/hiro",
    specPath: "characters/hiro/character-spec.json",
    principlesPath: "characters/hiro/character-principles.json",
    goldenEvaluationPath: "characters/hiro/best-evaluation.json",
  });
});

test("validates character specs and resolves the user address", () => {
  assert.equal(characterSpecSchema.parse(spec).identity.user_address, "プロデューサー");

  const { user_address: ignoredUserAddress, ...identityWithoutAddress } =
    spec.identity;
  const withoutAddress = {
    ...spec,
    identity: identityWithoutAddress,
  };
  assert.equal(
    characterSpecSchema.parse(withoutAddress).identity.user_address,
    "ユーザー",
  );

  const { name: ignoredName, ...identityWithoutName } = spec.identity;
  assert.throws(
    () =>
      characterSpecSchema.parse({
        ...spec,
        identity: identityWithoutName,
      }),
    /Required/,
  );
});

test("extracts explicit Character Spec reference candidates without duplicates", () => {
  const candidateSpec: CharacterSpec = {
    identity: {
      name: "Excluded Name",
      role: "role item",
      first_person: "first person item",
      user_address: "address item",
    },
    personality: ["personality item", "shared item"],
    values: ["value item"],
    relationship: {
      user_role: "relationship role item",
      traits: ["relationship trait item"],
    },
    speech_style: {
      language: "language item",
      tone: "tone item",
      guidelines: ["guideline item"],
    },
    behavior_preferences: ["behavior item", "shared item"],
    background: ["background item"],
  };

  const candidates = extractCharacterSpecReferenceCandidates(candidateSpec);
  for (const item of [
    "role item",
    "personality item",
    "value item",
    "relationship role item",
    "relationship trait item",
    "language item",
    "tone item",
    "guideline item",
    "behavior item",
    "background item",
  ]) {
    assert.ok(candidates.includes(item), `missing candidate: ${item}`);
  }
  assert.equal(candidates.includes("Excluded Name"), false);
  assert.equal(candidates.includes("first person item"), false);
  assert.equal(candidates.includes("address item"), false);
  assert.equal(candidates.filter((item) => item === "shared item").length, 1);
});

test("validates Interaction Policy", () => {
  assert.deepEqual(
    interactionPolicySchema.parse({ principles: ["  共通方針  "] }),
    { principles: ["共通方針"] },
  );
  assert.throws(
    () => interactionPolicySchema.parse({ principles: [] }),
    /at least 1 element/,
  );
  assert.throws(
    () => interactionPolicySchema.parse({ principles: "invalid" }),
    /Expected array/,
  );
});

test("validates Character Principles", () => {
  assert.deepEqual(
    characterPrinciplesSchema.parse({ principles: ["  固有原則  "] }),
    { principles: ["固有原則"] },
  );
  assert.throws(
    () => characterPrinciplesSchema.parse({ principles: [] }),
    /at least 1 element/,
  );
  assert.throws(
    () => characterPrinciplesSchema.parse({ principles: ["  "] }),
    /at least 1 character/,
  );
});

test("validates Golden Evaluation and reuses RuntimeOutput rules", () => {
  const valid = {
    results: [{ event: "event", output, notes: ["note"] }],
  };
  assert.deepEqual(bestEvaluationSchema.parse(valid).results[0]?.output, output);

  assert.throws(
    () =>
      bestEvaluationSchema.parse({
        results: [
          {
            event: "event",
            output: { ...output, speech: null },
            notes: ["note"],
          },
        ],
      }),
    /Invalid input/,
  );
  assert.throws(
    () =>
      bestEvaluationSchema.parse({
        results: [{ event: "event", output }],
      }),
    /Required/,
  );
  assert.throws(
    () =>
      bestEvaluationSchema.parse({
        results: [{ event: "event", output, notes: [""] }],
      }),
    /at least 1 character/,
  );
});

test("selects all required few-shot examples and rejects missing events", () => {
  const bestEvaluation = bestEvaluationSchema.parse({
    results: FEW_SHOT_EVENTS.map((event) => ({
      event,
      output,
      notes: ["note"],
    })),
  });

  assert.deepEqual(
    selectFewShotExamples(bestEvaluation).map((result) => result.event),
    [...FEW_SHOT_EVENTS],
  );
  assert.throws(
    () =>
      selectFewShotExamples({
        ...bestEvaluation,
        results: bestEvaluation.results.slice(1),
      }),
    /Required few-shot event is missing/,
  );
});

test("keeps Interaction Policy outside the Character Package", () => {
  const interactionPolicy = interactionPolicySchema.parse({
    principles: ["共通方針"],
  });
  const characterPrinciples = characterPrinciplesSchema.parse({
    principles: ["固有原則"],
  });
  const bestEvaluation = bestEvaluationSchema.parse({
    results: FEW_SHOT_EVENTS.map((event) => ({
      event,
      output,
      notes: ["note"],
    })),
  });

  const resources = createCognitionResources(
    interactionPolicy,
    spec,
    characterPrinciples,
    bestEvaluation,
  );

  assert.deepEqual(resources.interactionPolicy, interactionPolicy);
  assert.deepEqual(resources.characterPackage, {
    spec,
    principles: characterPrinciples,
    goldenEvaluation: bestEvaluation,
    reactionPresets: { presets: [] },
  });
  assert.equal("interactionPolicy" in resources.characterPackage, false);
});

test("loads the current Character Package and root Interaction Policy", async () => {
  const resources = await loadCognitionResources({ characterId: "hiro" });

  assert.equal(resources.characterPackage.spec.identity.name, "篠澤広");
  assert.ok(resources.characterPackage.principles.principles.length > 0);
  assert.ok(resources.characterPackage.goldenEvaluation.results.length > 0);
  assert.deepEqual(
    resources.characterPackage.reactionPresets.presets.map(({ id }) => id),
    ["greeting.default", "silence.wait", "return_home.default"],
  );
  assert.ok(resources.interactionPolicy.principles.length > 0);
  assert.equal("interactionPolicy" in resources.characterPackage, false);
  assert.deepEqual(
    resources.fewShotExamples.map((example) => example.event),
    [...FEW_SHOT_EVENTS],
  );
});

test("loads a Character Package without optional Reaction Presets", async () => {
  const characterId = `without_presets_${process.pid}`;
  const directory = new URL(`../characters/${characterId}/`, import.meta.url);
  const sourceDirectory = new URL("../characters/hiro/", import.meta.url);
  await mkdir(directory, { recursive: true });
  try {
    await Promise.all(
      [
        "character-spec.json",
        "character-principles.json",
        "best-evaluation.json",
      ].map((fileName) =>
        copyFile(new URL(fileName, sourceDirectory), new URL(fileName, directory)),
      ),
    );

    const resources = await loadCognitionResources({ characterId });

    assert.deepEqual(resources.characterPackage.reactionPresets, {
      presets: [],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports the Character ID and path when a package file is missing", async () => {
  await assert.rejects(
    loadCognitionResources({ characterId: "missing-character" }),
    /Character package "missing-character" was not found: characters\/missing-character/,
  );
});

test("reports a required file missing from an existing package", async () => {
  const characterId = `missing_file_${process.pid}`;
  const directory = new URL(`../characters/${characterId}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  try {
    await assert.rejects(
      loadCognitionResources({ characterId }),
      new RegExp(
        `Character package "${characterId}" is missing required file: characters/${characterId}/`,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("attaches Golden comparison information", () => {
  const golden = { event: "event", output, notes: ["note"] };
  assert.deepEqual(createGoldenReference(output, golden), {
    golden_output: output,
    golden_notes: ["note"],
    comparison: {
      action_type_match: true,
      speech_exact_match: true,
      micro_reaction_exact_match: true,
    },
  });
  assert.deepEqual(createGoldenReference(waitOutput, golden).comparison, {
    action_type_match: false,
    speech_exact_match: false,
    micro_reaction_exact_match: false,
  });
  assert.deepEqual(createGoldenReference(output, undefined), {
    golden_output: null,
    golden_notes: null,
    comparison: null,
  });
});

test("loads migrated and time-context evaluation Events", async () => {
  const cases = evaluationCasesSchema.parse(
    JSON.parse(
      await readFile(new URL("../evaluation/events.json", import.meta.url), "utf8"),
    ),
  );
  assert.equal(cases.length, 13);
  assert.equal(new Set(cases.map(({ name }) => name)).size, cases.length);

  for (const name of [
    "user said hello",
    "user returned home",
    "user said they failed an exam",
    "user said they are cold",
    "user asked for a drink",
    "user has been silent for a while",
    "user praised the character",
    "user criticized the character",
    "user said the task was too easy",
    "user said they want to try something difficult",
  ]) {
    assert.ok(cases.some((evaluationCase) => evaluationCase.name === name));
  }

  const evening = cases.find(
    ({ name }) => name === "user returned home in the evening",
  );
  const morning = cases.find(
    ({ name }) => name === "user returned home early in the morning",
  );
  const spoken = cases.find(({ name }) => name === "user said tadaima");
  const praised = cases.find(({ name }) => name === "user praised the character");
  const criticized = cases.find(
    ({ name }) => name === "user criticized the character",
  );
  const tooEasy = cases.find(
    ({ name }) => name === "user said the task was too easy",
  );
  assert.equal(evening?.event.type, "system.observation");
  assert.equal(
    evening && getEventTimeContext(evening.event).time_of_day,
    "evening",
  );
  assert.equal(morning?.event.type, "system.observation");
  assert.equal(
    morning && getEventTimeContext(morning.event).time_of_day,
    "morning",
  );
  assert.equal(spoken?.event.type, "user.message");
  assert.equal(
    spoken?.event.type === "user.message" ? spoken.event.payload.text : null,
    "ただいま",
  );
  assert.equal(
    praised?.event.type === "user.message" ? praised.event.payload.text : null,
    "Hiro, you did a great job. I'm impressed by you.",
  );
  assert.equal(
    criticized?.event.type === "user.message"
      ? criticized.event.payload.text
      : null,
    "Hiro, that response was not good.",
  );
  assert.equal(
    tooEasy?.event.type === "user.message" ? tooEasy.event.payload.text : null,
    "I thought that task was too easy for me.",
  );
});

test("includes Character ID in evaluation reports", () => {
  const evaluatedAt = new Date("2026-01-02T03:04:05.000Z");
  assert.deepEqual(
    createEvaluationReport({
      evaluatedAt,
      model: "model",
      characterId: "hiro",
      results: [{ name: "case", event: returnedHomeEvent }],
    }),
    {
      evaluated_at: "2026-01-02T03:04:05.000Z",
      model: "model",
      character_id: "hiro",
      results: [{ name: "case", event: returnedHomeEvent }],
    },
  );
});

test("adds Cognition diagnostics to evaluation event results", () => {
  assert.deepEqual(createCognitionEvaluationFields(validatedCognitionOutput), {
    cognition: {
      perception: cognitionOutput.perception,
      character_references: cognitionOutput.character_references,
      response_plan: cognitionOutput.response_plan,
      reference_warnings: [],
    },
    output,
  });
});

test("applies state effects and supplies updated state and memory next time", async () => {
  const engine = new StubEngine();
  const runtime = new CharacterRuntime(spec, engine);

  await runtime.processEvent(returnedHomeEvent);
  assert.deepEqual(runtime.getState(), {
    energy: 3,
    affinity: 1,
    mood: "concerned",
  });
  assert.deepEqual(runtime.getMemory()[0]?.output, output);
  assert.deepEqual(runtime.getMemory()[0]?.event, returnedHomeEvent);
  assert.equal("perception" in runtime.getMemory()[0]!, false);
  assert.equal("character_references" in runtime.getMemory()[0]!, false);
  assert.equal("response_plan" in runtime.getMemory()[0]!, false);

  await runtime.processEvent(messageEvent);
  assert.equal(engine.inputs[1]?.currentState.energy, 3);
  assert.equal(engine.inputs[1]?.recentMemory.length, 1);
  assert.deepEqual(engine.inputs[1]?.recentMemory[0]?.event, returnedHomeEvent);
  assert.deepEqual(engine.inputs[0]?.currentEvent, returnedHomeEvent);
  assert.deepEqual(engine.inputs[0]?.eventTime, {
    occurred_at: "2026-07-17T19:30:00+09:00",
    time_of_day: "evening",
    utc_offset: "+09:00",
  });
});

test("clamps numeric state values to their allowed ranges", async () => {
  const runtime = new CharacterRuntime(spec, new StubEngine(), {
    initialState: { energy: 1, affinity: 10, mood: "calm" },
  });

  await runtime.processEvent(messageEvent);
  assert.deepEqual(runtime.getState(), {
    energy: 0,
    affinity: 10,
    mood: "concerned",
  });
});

test("recent memory keeps only the configured number of entries", () => {
  const memory = new RecentMemory(2);
  const state = { energy: 5, affinity: 0, mood: "calm" as const };

  const events = ["one", "two", "three"].map((text, index) =>
    createUserMessageEvent(text, `2026-07-17T12:0${index}:00+09:00`),
  );
  for (const event of events) {
    memory.add({ event, output, state_after: state });
  }

  assert.deepEqual(
    memory.getAll().map((entry) => entry.event),
    events.slice(1),
  );
});

test("accepts valid structured responses without network access", () => {
  assert.deepEqual(
    parseTestCognitionOutput(JSON.stringify(cognitionOutput)),
    validatedCognitionOutput,
  );
  assert.deepEqual(
    parseTestCognitionOutput(JSON.stringify(waitCognitionOutput)),
    { ...waitCognitionOutput, reference_warnings: [] },
  );
  assert.deepEqual(
    parseTestCognitionOutput(JSON.stringify(reactionCognitionOutput)),
    { ...reactionCognitionOutput, reference_warnings: [] },
  );
});

test("resolves registered Presets without accepting LLM-generated speech", () => {
  const presetDraft = {
    ...cognitionOutput,
    response_plan: {
      ...cognitionOutput.response_plan,
      response_mode: "preset",
      preset_id: "greeting.default",
    },
    runtime_output: {
      event_summary: output.event_summary,
      state_effect: output.state_effect,
    },
  };
  const resolved = parseGeminiCognitionOutput(JSON.stringify(presetDraft), {
    ...parseOptions,
    reactionPresets,
  });

  assert.equal(resolved.response_plan.response_mode, "preset");
  assert.equal(resolved.response_plan.preset_id, "greeting.default");
  assert.deepEqual(resolved.runtime_output, {
    event_summary: output.event_summary,
    state_effect: output.state_effect,
    action_intent: { type: "respond" },
    speech: "登録済みの挨拶です。",
    micro_reaction: "小さく微笑む",
  });
  assert.throws(
    () =>
      parseGeminiCognitionOutput(
        JSON.stringify({
          ...presetDraft,
          runtime_output: {
            ...presetDraft.runtime_output,
            speech: "LLMが作った発話",
          },
        }),
        { ...parseOptions, reactionPresets },
      ),
    /Gemini response does not match CognitionOutput/,
  );

  const silentPreset = parseGeminiCognitionOutput(
    JSON.stringify({
      ...presetDraft,
      response_plan: {
        ...presetDraft.response_plan,
        preset_id: "silence.wait",
        response_length: "short",
      },
    }),
    { ...parseOptions, reactionPresets },
  );
  assert.equal(silentPreset.response_plan.response_length, "none");
  assert.deepEqual(silentPreset.runtime_output.action_intent, { type: "wait" });
  assert.equal(silentPreset.runtime_output.speech, null);
});

test("rejects unknown or duplicate Reaction Presets", () => {
  const presetDraft = {
    ...cognitionOutput,
    response_plan: {
      ...cognitionOutput.response_plan,
      response_mode: "preset",
      preset_id: "missing.preset",
    },
    runtime_output: {
      event_summary: output.event_summary,
      state_effect: output.state_effect,
    },
  };
  assert.throws(
    () =>
      parseGeminiCognitionOutput(JSON.stringify(presetDraft), {
        ...parseOptions,
        reactionPresets,
      }),
    /Unknown Reaction Preset: missing\.preset/,
  );
  assert.throws(
    () =>
      reactionPresetsSchema.parse({
        presets: [reactionPresets.presets[0], reactionPresets.presets[0]],
      }),
    /Reaction Preset IDs must be unique/,
  );
});

test("rejects the old interpretation field and a missing event_summary", () => {
  const { event_summary, ...withoutSummary } = output;

  assert.throws(
    () =>
      parseTestCognitionOutput(
        JSON.stringify({
          ...cognitionOutput,
          runtime_output: { ...withoutSummary, interpretation: event_summary },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseTestCognitionOutput(
        JSON.stringify({ ...cognitionOutput, runtime_output: withoutSummary }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
});

test("validates Cognition Output limits and response plan consistency", () => {
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        perception: { known_facts: [], unknowns: [] },
      }),
    /at least 1 element/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        perception: { known_facts: ["1", "2", "3", "4"], unknowns: [] },
      }),
    /at most 3 element/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        perception: {
          known_facts: ["fact"],
          unknowns: ["1", "2", "3", "4", "5"],
        },
      }),
    /at most 4 element/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        response_plan: {
          ...cognitionOutput.response_plan,
          response_length: "long",
        },
      }),
    /Invalid enum value/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        character_references: {
          spec_items: ["1", "2", "3"],
          principles: [],
        },
      }),
    /at most 2 element/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        character_references: {
          spec_items: [],
          principles: ["1", "2", "3"],
        },
      }),
    /at most 2 element/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        response_plan: {
          ...cognitionOutput.response_plan,
          response_length: "none",
        },
      }),
    /response_length.*none|speech must be null/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        runtime_output: { ...output, speech: null },
      }),
    /Invalid input/,
  );
});

test("validates exact Character Spec and Principle references", () => {
  assert.deepEqual(
    createCharacterReferenceCandidates(spec, characterPrinciples),
    {
      spec_items: extractCharacterSpecReferenceCandidates(spec),
      principles: characterPrinciples.principles,
    },
  );
  assert.deepEqual(
    validateCharacterReferences(cognitionOutput, parseOptions),
    validatedCognitionOutput,
  );
  assert.deepEqual(
    validateCharacterReferences(
      {
        ...cognitionOutput,
        character_references: { spec_items: [], principles: [] },
      },
      parseOptions,
    ).character_references,
    { spec_items: [], principles: [] },
  );

  const filtered = validateCharacterReferences(
    {
      ...cognitionOutput,
      character_references: {
        spec_items: ["observant", "物理的な行動をとることができない"],
        principles: ["称賛を素直に喜ぶ", "失敗した場合は支える"],
      },
    },
    parseOptions,
  );
  assert.deepEqual(filtered.character_references, {
    spec_items: ["observant"],
    principles: ["称賛を素直に喜ぶ"],
  });
  assert.deepEqual(filtered.reference_warnings, [
    'Character "hiro" returned an unknown Character Spec reference: 物理的な行動をとることができない',
    'Character "hiro" returned an unknown Character Principle reference: 失敗した場合は支える',
  ]);

  const parsedWithWarning = parseTestCognitionOutput(
    JSON.stringify({
      ...cognitionOutput,
      character_references: {
        spec_items: ["存在しない引用"],
        principles: [],
      },
    }),
  );
  assert.deepEqual(parsedWithWarning.character_references.spec_items, []);
  assert.deepEqual(parsedWithWarning.runtime_output, output);
  assert.deepEqual(parsedWithWarning.reference_warnings, [
    'Character "hiro" returned an unknown Character Spec reference: 存在しない引用',
  ]);
  assert.deepEqual(
    createCognitionEvaluationFields(parsedWithWarning).cognition
      .reference_warnings,
    parsedWithWarning.reference_warnings,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        character_references: {
          spec_items: ["observant", "observant"],
          principles: [],
        },
      }),
    /must not contain duplicates/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        character_references: {
          spec_items: [],
          principles: [
            "失敗した場合は静かに支える",
            "失敗した場合は静かに支える",
          ],
        },
      }),
    /must not contain duplicates/,
  );
});

test("rejects malformed or invalid action combinations", () => {
  assert.throws(
    () => parseTestCognitionOutput(""),
    /Gemini returned an empty response/,
  );
  assert.throws(
    () => parseTestCognitionOutput("not json"),
    /Gemini returned invalid JSON/,
  );
  assert.throws(
    () => parseTestCognitionOutput('{"event_summary":"missing fields"}'),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseTestCognitionOutput(
        JSON.stringify({
          ...cognitionOutput,
          runtime_output: { ...output, speech: null },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseTestCognitionOutput(
        JSON.stringify({
          ...waitCognitionOutput,
          runtime_output: { ...waitOutput, speech: "話しかける" },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseTestCognitionOutput(
        JSON.stringify({
          ...reactionCognitionOutput,
          runtime_output: { ...reactionOutput, micro_reaction: null },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseTestCognitionOutput(
        JSON.stringify({
          ...reactionCognitionOutput,
          runtime_output: { ...reactionOutput, speech: "話しかける" },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
});

test("does not update state or memory when cognition returns invalid output", async () => {
  const runtime = new CharacterRuntime(spec, new InvalidOutputEngine());

  await assert.rejects(
    runtime.processEvent(messageEvent),
    /Gemini response does not match CognitionOutput/,
  );
  assert.deepEqual(runtime.getState(), { energy: 5, affinity: 0, mood: "calm" });
  assert.deepEqual(runtime.getMemory(), []);
});
