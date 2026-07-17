import type {
  CharacterPrinciples,
  CharacterSpec,
  CognitionOutput,
} from "./schema.js";

export type CharacterReferenceCandidates = {
  spec_items: string[];
  principles: string[];
};

export function extractCharacterSpecReferenceCandidates(
  spec: CharacterSpec,
): string[] {
  return [
    spec.identity.role,
    spec.identity.first_person,
    spec.identity.user_address,
    ...spec.personality,
    ...spec.values,
    spec.relationship.user_role,
    ...spec.relationship.traits,
    spec.speech_style.language,
    spec.speech_style.tone,
    ...spec.speech_style.guidelines,
    ...spec.behavior_preferences,
    ...spec.background,
  ].filter((item, index, items) => items.indexOf(item) === index);
}

export function createCharacterReferenceCandidates(
  spec: CharacterSpec,
  principles: CharacterPrinciples,
): CharacterReferenceCandidates {
  return {
    spec_items: extractCharacterSpecReferenceCandidates(spec),
    principles: [...new Set(principles.principles)],
  };
}

export function validateCharacterReferences(
  output: CognitionOutput,
  options: {
    characterId: string;
    characterSpec: CharacterSpec;
    characterPrinciples: CharacterPrinciples;
  },
): CognitionOutput {
  const candidates = createCharacterReferenceCandidates(
    options.characterSpec,
    options.characterPrinciples,
  );
  const specItems = new Set(candidates.spec_items);
  const principles = new Set(candidates.principles);

  for (const reference of output.character_references.spec_items) {
    if (!specItems.has(reference)) {
      throw new Error(
        `Character "${options.characterId}" returned an unknown Character Spec reference: ${reference}`,
      );
    }
  }
  for (const reference of output.character_references.principles) {
    if (!principles.has(reference)) {
      throw new Error(
        `Character "${options.characterId}" returned an unknown Character Principle reference: ${reference}`,
      );
    }
  }

  return output;
}
