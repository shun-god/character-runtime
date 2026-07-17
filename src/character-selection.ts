export const DEFAULT_CHARACTER_ID = "hiro";

const CHARACTER_ID_PATTERN = /^[a-z0-9_-]+$/;

export type CharacterPackageLocation = {
  id: string;
  directory: string;
  specPath: string;
  principlesPath: string;
  goldenEvaluationPath: string;
};

export function validateCharacterId(characterId: string): string {
  if (!CHARACTER_ID_PATTERN.test(characterId)) {
    throw new Error(
      `Invalid character ID "${characterId}". Character IDs may contain only lowercase letters, numbers, hyphens, and underscores.`,
    );
  }
  return characterId;
}

export function resolveCharacterId(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): string {
  let argumentCharacterId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--character") {
      if (argumentCharacterId !== undefined) {
        throw new Error("The --character option may be specified only once.");
      }
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("The --character option requires a value.");
      }
      argumentCharacterId = value;
      index += 1;
    } else if (argument?.startsWith("--character=")) {
      if (argumentCharacterId !== undefined) {
        throw new Error("The --character option may be specified only once.");
      }
      argumentCharacterId = argument.slice("--character=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return validateCharacterId(
    argumentCharacterId ?? environment.CHARACTER_ID ?? DEFAULT_CHARACTER_ID,
  );
}

export function resolveCharacterPackageLocation(
  characterId: string,
): CharacterPackageLocation {
  const id = validateCharacterId(characterId);
  const directory = `characters/${id}`;
  return {
    id,
    directory,
    specPath: `${directory}/character-spec.json`,
    principlesPath: `${directory}/character-principles.json`,
    goldenEvaluationPath: `${directory}/best-evaluation.json`,
  };
}
