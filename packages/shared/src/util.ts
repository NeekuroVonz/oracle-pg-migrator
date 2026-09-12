export function iso(date: Date): string {
  return date.toISOString();
}

export function assertNever(value: never, message = "unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}

export function suggestedDiscoverySchemas(configured: string[], sessionUser: string): string[] {
  const schemas = [
    ...new Set(configured.map((schema) => schema.trim().toUpperCase()).filter(Boolean)),
  ];
  if (schemas.length > 0) {
    return schemas;
  }
  const user = sessionUser.trim().toUpperCase();
  return user ? [user] : [];
}
