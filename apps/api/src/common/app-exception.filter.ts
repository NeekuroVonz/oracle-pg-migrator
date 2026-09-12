import { AppError } from "@migrator/shared";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

export function isPayloadTooLargeError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { name?: string; type?: string; status?: number; statusCode?: number };
  return (
    candidate.name === "PayloadTooLargeError" ||
    candidate.type === "entity.too.large" ||
    candidate.status === 413 ||
    candidate.statusCode === 413
  );
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === "string"
          ? payload
          : typeof payload === "object" && payload && "message" in payload
            ? String(payload.message)
            : exception.message;
      response.status(status).json({
        error: {
          code: "HTTP_ERROR",
          message,
        },
      });
      return;
    }

    if (isPayloadTooLargeError(exception)) {
      response.status(413).json({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message:
            "Request body is too large. Paste fewer include/exclude lines, or use globs instead of a full object list.",
        },
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
  }
}
