import type {
  CharacterPrinciples,
  CharacterSpec,
  CognitionOutput,
} from "./schema.js";

export type CharacterReferenceCandidates = {
  spec_items: string[];
  principles: string[];
};

export type CognitionOutputWithReferenceWarnings = CognitionOutput & {
  reference_warnings: string[];
};

export function extractCharacterSpecReferenceCandidates(
  spec: CharacterSpec,
): string[] {
  return [
    spec.identity.role,
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
): CognitionOutputWithReferenceWarnings {
  const candidates = createCharacterReferenceCandidates(
    options.characterSpec,
    options.characterPrinciples,
  );
  const specItems = new Set(candidates.spec_items);
  const principles = new Set(candidates.principles);

  const validSpecItems = output.character_references.spec_items.filter((reference) =>
    specItems.has(reference),
  );
  const validPrinciples = output.character_references.principles.filter(
    (reference) => principles.has(reference),
  );
  const referenceWarnings = [
    ...output.character_references.spec_items
      .filter((reference) => !specItems.has(reference))
      .map(
        (reference) =>
          `Character "${options.characterId}" returned an unknown Character Spec reference: ${reference}`,
      ),
    ...output.character_references.principles
      .filter((reference) => !principles.has(reference))
      .map(
        (reference) =>
          `Character "${options.characterId}" returned an unknown Character Principle reference: ${reference}`,
      ),
  ];

  return {
    ...output,
    character_references: {
      spec_items: validSpecItems,
      principles: validPrinciples,
    },
    reference_warnings: referenceWarnings,
  };
}
