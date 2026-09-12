# AI provider design

Phase 6.

Providers implement `MigrationAIProvider` (`convert`, `fix`, `verify`, `listModels`) and declare capabilities. Migration logic must not import a vendor SDK. HTTP adapters live in `@migrator/ai-core`; `@migrator/ai-openai`, `ai-anthropic`, `ai-gemini`, `ai-cursor`, and `ai-openai-compatible` are thin factories.

Defaults:

- Conversion AI: `MAXIMUM_ACCURACY` only (after rules)
- Fix AI: compile failures, max 3 attempts, then `REVIEW_REQUIRED`
- Verification AI: `BALANCED` (failed/high-risk) and `MAXIMUM_ACCURACY` (compiled objects)
- FAST: rules → compile → AI fix only if a provider is configured

Prompts live in `prompts/converter`, `prompts/fixer`, `prompts/verifier` and are versioned. Responses must be structured JSON. Uncertain conversions return `REVIEW_REQUIRED`. Do not invent business logic. Never send credentials or infrastructure secrets.

The verifier cannot mark `VALIDATED`. See [ADR-007](./decisions/ADR-007-ai-never-validates.md).
