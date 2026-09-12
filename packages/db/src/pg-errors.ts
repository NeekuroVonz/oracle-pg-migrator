const FAILED_QUERY_PREFIX = "Failed query:";
const MAX_ERROR_MESSAGE_LENGTH = 300;

function errorMessage(value: unknown): string | null {
  if (value instanceof Error && value.message) {
    return value.message;
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    const message = value.message;
    return typeof message === "string" && message.length > 0 ? message : null;
  }
  return null;
}

function walkErrorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    chain.push(current);
    if (typeof current === "object" && current !== null && "cause" in current) {
      current = current.cause;
      continue;
    }
    break;
  }
  return chain;
}

export function isUniqueViolation(error: unknown): boolean {
  for (const current of walkErrorChain(error)) {
    if (typeof current === "object" && current !== null && "code" in current) {
      if (current.code === "23505") {
        return true;
      }
    }
  }
  return false;
}

export function formatDatabaseError(
  error: unknown,
  fallback = "Metadata database query failed",
): string {
  const messages = walkErrorChain(error)
    .map(errorMessage)
    .filter((message): message is string => Boolean(message));
  const useful = messages.find((message) => !message.startsWith(FAILED_QUERY_PREFIX));
  const chosen = useful ?? fallback;
  if (chosen.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return chosen;
  }
  return `${chosen.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)}...`;
}
