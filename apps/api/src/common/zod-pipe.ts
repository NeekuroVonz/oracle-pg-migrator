import { ValidationAppError } from "@migrator/shared";
import type { PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationAppError("Invalid request", result.error.flatten());
    }
    return result.data;
  }
}
