import { z } from "zod";

import { runtimeEventSchema } from "./event.js";

export const evaluationCaseSchema = z.object({
  name: z.string().trim().min(1),
  event: runtimeEventSchema,
});

export const evaluationCasesSchema = z.array(evaluationCaseSchema).min(1);

export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
