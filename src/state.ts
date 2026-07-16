import type { Mood, RuntimeOutput } from "./schema.js";

export type CharacterState = {
  energy: number;
  affinity: number;
  mood: Mood;
};

export const initialState: CharacterState = {
  energy: 5,
  affinity: 0,
  mood: "calm",
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function applyStateEffect(
  state: CharacterState,
  effect: RuntimeOutput["state_effect"],
): CharacterState {
  return {
    energy: clamp(state.energy + effect.energy, 0, 10),
    affinity: clamp(state.affinity + effect.affinity, -10, 10),
    mood: effect.mood,
  };
}
