import type { CognitionEngine } from "./cognition.js";
import { getEventTimeContext, runtimeEventSchema, type RuntimeEvent } from "./event.js";
import { RecentMemory } from "./memory.js";
import type { CharacterSpec, RuntimeOutput } from "./schema.js";
import {
  applyStateEffect,
  initialState,
  type CharacterState,
} from "./state.js";

export class CharacterRuntime {
  #state: CharacterState;
  readonly #memory: RecentMemory;

  constructor(
    private readonly characterSpec: CharacterSpec,
    private readonly cognitionEngine: CognitionEngine,
    options: { initialState?: CharacterState; memoryLimit?: number } = {},
  ) {
    this.#state = { ...(options.initialState ?? initialState) };
    this.#memory = new RecentMemory(options.memoryLimit ?? 5);
  }

  async processEvent(event: RuntimeEvent): Promise<RuntimeOutput> {
    const parsedEvent = runtimeEventSchema.parse(event);
    const eventTime = getEventTimeContext(parsedEvent);

    const output = await this.cognitionEngine.process({
      characterSpec: this.characterSpec,
      currentState: this.getState(),
      recentMemory: this.#memory.getAll(),
      currentEvent: parsedEvent,
      eventTime,
    });

    this.#state = applyStateEffect(this.#state, output.state_effect);
    this.#memory.add({
      event: parsedEvent,
      output,
      state_after: this.getState(),
    });

    return output;
  }

  getState(): CharacterState {
    return { ...this.#state };
  }

  getMemory() {
    return this.#memory.getAll();
  }
}
