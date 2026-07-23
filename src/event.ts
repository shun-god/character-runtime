import { z } from "zod";

const isoDateTimeParts =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:(?<zulu>Z)|[+-](?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/;

function hasValidCalendarDate(value: string): boolean {
  const match = isoDateTimeParts.exec(value);
  if (!match?.groups) return false;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const offsetIsValid =
    match.groups.zulu === "Z" ||
    (Number(match.groups.offsetHour) <= 23 &&
      Number(match.groups.offsetMinute) <= 59);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    offsetIsValid &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1]!
  );
}

const occurredAtSchema = z
  .string()
  .datetime({ offset: true, message: "occurred_at must be a valid ISO 8601 date-time with a timezone offset" })
  .refine(hasValidCalendarDate, {
    message: "occurred_at must contain a valid calendar date",
  });

const userMessageEventSchema = z
  .object({
    type: z.literal("user.message"),
    source: z.literal("user"),
    occurred_at: occurredAtSchema,
    payload: z
      .object({
        text: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

const systemObservationEventSchema = z
  .object({
    type: z.literal("system.observation"),
    source: z.literal("system"),
    occurred_at: occurredAtSchema,
    payload: z
      .object({
        name: z.string().trim().min(1),
        data: z.record(z.unknown()),
      })
      .strict(),
  })
  .strict();

export const runtimeEventSchema = z.discriminatedUnion("type", [
  userMessageEventSchema,
  systemObservationEventSchema,
]);

export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;
export type TimeOfDay = "morning" | "daytime" | "evening" | "night";

export type EventTimeContext = {
  occurred_at: string;
  time_of_day: TimeOfDay;
  utc_offset: string;
};

const pad = (value: number): string => String(value).padStart(2, "0");

export function formatLocalDateTimeWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${milliseconds}${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

export function createUserMessageEvent(
  text: string,
  occurredAt = formatLocalDateTimeWithOffset(new Date()),
): RuntimeEvent {
  return runtimeEventSchema.parse({
    type: "user.message",
    source: "user",
    occurred_at: occurredAt,
    payload: { text },
  });
}

export function getEventTimeContext(event: RuntimeEvent): EventTimeContext {
  const occurredAt = occurredAtSchema.parse(event.occurred_at);
  const hourMatch = /T(?<hour>\d{2}):/.exec(occurredAt);
  const offsetMatch = /(?<offset>Z|[+-]\d{2}:\d{2})$/.exec(occurredAt);
  if (!hourMatch?.groups?.hour || !offsetMatch?.groups?.offset) {
    throw new Error(`Unable to derive time context from occurred_at: ${occurredAt}`);
  }

  const hour = Number(hourMatch.groups.hour);
  const timeOfDay: TimeOfDay =
    hour >= 5 && hour < 12
      ? "morning"
      : hour >= 12 && hour < 17
        ? "daytime"
        : hour >= 17 && hour < 22
          ? "evening"
          : "night";

  return {
    occurred_at: occurredAt,
    time_of_day: timeOfDay,
    utc_offset: offsetMatch.groups.offset,
  };
}
