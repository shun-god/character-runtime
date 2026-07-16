import type { CharacterState } from "./state.js";
import type { RuntimeOutput } from "./schema.js";

export type MemoryEntry = {
  event: string;
  output: RuntimeOutput;
  state_after: CharacterState;
};

export class RecentMemory {
  readonly #entries: MemoryEntry[] = [];

  constructor(private readonly limit = 5) {}

  add(entry: MemoryEntry): void {
    this.#entries.push(entry);
    if (this.#entries.length > this.limit) {
      this.#entries.shift();
    }
  }

  getAll(): readonly MemoryEntry[] {
    return [...this.#entries];
  }
}
