/** Disjoint-set forest with union by size and path halving. */
export class UnionFind {
  private parent = new Map<string, string>();
  private size = new Map<string, number>();

  add(id: string): void {
    if (this.parent.has(id)) return;
    this.parent.set(id, id);
    this.size.set(id, 1);
  }

  find(id: string): string {
    this.add(id);
    let node = id;
    for (;;) {
      const parent = this.parent.get(node) as string;
      if (parent === node) return node;
      const grand = this.parent.get(parent) as string;
      this.parent.set(node, grand);
      node = grand;
    }
  }

  union(a: string, b: string): boolean {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return false;
    if ((this.size.get(rootA) as number) < (this.size.get(rootB) as number)) {
      [rootA, rootB] = [rootB, rootA];
    }
    this.parent.set(rootB, rootA);
    this.size.set(rootA, (this.size.get(rootA) as number) + (this.size.get(rootB) as number));
    return true;
  }

  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }

  /** Groups with more than one member, largest first. */
  groups(minSize = 2): string[][] {
    const buckets = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const bucket = buckets.get(root);
      if (bucket) bucket.push(id);
      else buckets.set(root, [id]);
    }
    return [...buckets.values()]
      .filter((group) => group.length >= minSize)
      .sort((x, y) => y.length - x.length || (x[0] as string).localeCompare(y[0] as string));
  }
}
