const REDACTED = "[REDACTED]";

const PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi,
  /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*([^\s"',\\]+)/gi,
  /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bAIza[A-Za-z0-9_-]{20,}/g,
  /\bv1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+/g,
  /\bSECRETS_MASTER_KEY\b/gi,
];

export function redactSecrets(input: string): string {
  let output = input;
  for (const pattern of PATTERNS) {
    output = output.replace(pattern, (match) => {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(match)) {
        const scheme = match.split("://")[0] ?? "http";
        return `${scheme}://[REDACTED]@`;
      }
      if (
        /^(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|authorization)\s*[:=]/i.test(
          match,
        )
      ) {
        const key = match.split(/[:=]/)[0] ?? "secret";
        return `${key}=${REDACTED}`;
      }
      if (/^Bearer\s+/i.test(match)) {
        return "Bearer [REDACTED]";
      }
      return REDACTED;
    });
  }
  return output;
}

export function redactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message.replace(/\?[^?\s]*/g, ""));
}

export function wasRedacted(original: string, redacted: string): boolean {
  return original !== redacted;
}
