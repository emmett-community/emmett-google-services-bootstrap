import type { Database } from 'firebase-admin/database';

type DataSnapshot = {
  val: () => unknown;
};

class InMemorySnapshot implements DataSnapshot {
  constructor(private readonly value: unknown) {}

  val(): unknown {
    return this.value;
  }
}

class InMemoryReference {
  constructor(
    private readonly store: Map<string, unknown>,
    private readonly path: string,
  ) {}

  child(childPath: string): InMemoryReference {
    const normalized = childPath.startsWith('/')
      ? childPath.slice(1)
      : childPath;
    return new InMemoryReference(this.store, `${this.path}/${normalized}`);
  }

  async once(eventType: 'value'): Promise<DataSnapshot> {
    if (eventType !== 'value') {
      throw new Error(`Unsupported event type: ${eventType}`);
    }
    return new InMemorySnapshot(this.store.get(this.path));
  }

  async set(value: unknown): Promise<void> {
    this.store.set(this.path, value);
  }

  async remove(): Promise<void> {
    this.store.delete(this.path);
  }
}

export const createInMemoryDatabase = (): Database => {
  const store = new Map<string, unknown>();

  return {
    ref: (path: string) => new InMemoryReference(store, path),
  } as unknown as Database;
};
