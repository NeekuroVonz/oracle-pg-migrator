import { Lock } from "lucide-react";

export function ReadOnlyCallout() {
  return (
    <div
      className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
      role="status"
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div>
        <p className="font-semibold text-warning">Source Oracle · READ ONLY</p>
        <p className="mt-1 text-muted">
          This migration service never modifies the Oracle source database. Write access cannot be
          enabled.
        </p>
      </div>
    </div>
  );
}
