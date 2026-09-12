import { MIGRATION_STRATEGY_LABELS, type MigrationStrategy } from "@migrator/shared";
import { Badge } from "@/components/ui/badge";

export function StrategyBadge({ strategy }: { strategy: MigrationStrategy }) {
  return (
    <Badge className={strategy === "MAXIMUM_ACCURACY" ? "border-accent text-accent" : undefined}>
      {MIGRATION_STRATEGY_LABELS[strategy]}
    </Badge>
  );
}
