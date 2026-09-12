export const DEFAULT_PAGE_SIZE = 20;

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const pages = pageCount(items.length, pageSize);
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
