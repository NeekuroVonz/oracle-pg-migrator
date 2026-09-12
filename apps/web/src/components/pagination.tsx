import { Button } from "@/components/ui/button";
import { pageCount } from "@/lib/pagination";

export function Pagination(props: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  const pages = pageCount(props.total, props.pageSize);
  if (props.total <= props.pageSize) {
    return null;
  }
  const from = (props.page - 1) * props.pageSize + 1;
  const to = Math.min(props.page * props.pageSize, props.total);
  const label = props.label ?? "items";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        {from.toLocaleString()}–{to.toLocaleString()} of {props.total.toLocaleString()} {label}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={props.page <= 1}
          onClick={() => props.onPageChange(props.page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted">
          {props.page} / {pages.toLocaleString()}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.page >= pages}
          onClick={() => props.onPageChange(Math.min(pages, props.page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
