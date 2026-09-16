const TYPE_RANK: Record<string, number> = {
  SEQUENCE: 1,
  TABLE: 2,
  CONSTRAINT: 4,
  INDEX: 3,
  VIEW: 5,
  MATERIALIZED_VIEW: 6,
};

export function conversionObjectOrder(objectType: string): number {
  return TYPE_RANK[objectType] ?? 50;
}

export interface RankedObject {
  id: string;
  owner: string;
  name: string;
  objectType: string;
}

export function compareConversionOrder(left: RankedObject, right: RankedObject): number {
  const rank = conversionObjectOrder(left.objectType) - conversionObjectOrder(right.objectType);
  if (rank !== 0) {
    return rank;
  }
  const owner = left.owner.localeCompare(right.owner);
  if (owner !== 0) {
    return owner;
  }
  const name = left.name.localeCompare(right.name);
  if (name !== 0) {
    return name;
  }
  return left.id.localeCompare(right.id);
}

export function orderByDag<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((left, right) => {
    const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}
