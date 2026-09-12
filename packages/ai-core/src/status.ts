import type { ObjectStatus } from "@migrator/shared";
import type { CompileStatusInput, TestStatusInput, VerifyStatusInput } from "./types";

export function objectStatusAfterCompile(input: CompileStatusInput): ObjectStatus {
  if (!input.compilePassed) {
    return "FAILED";
  }
  if (input.highRisk || input.reviewRequired) {
    return "REVIEW_REQUIRED";
  }
  return "TESTING";
}

export function objectStatusAfterTests(input: TestStatusInput): ObjectStatus {
  if (!input.compilePassed) {
    return "FAILED";
  }
  if (!input.testsPassed) {
    return "REVIEW_REQUIRED";
  }
  if (input.highRisk || input.reviewRequired) {
    return "REVIEW_REQUIRED";
  }
  return "VALIDATED";
}

export function objectStatusAfterVerify(input: VerifyStatusInput): ObjectStatus {
  const afterTests = objectStatusAfterTests(input);
  if (!input.compilePassed || !input.testsPassed) {
    return afterTests;
  }
  if (input.verdict !== "OK") {
    return "REVIEW_REQUIRED";
  }
  return afterTests;
}

export function objectStatusAfterAiExhausted(): ObjectStatus {
  return "REVIEW_REQUIRED";
}
