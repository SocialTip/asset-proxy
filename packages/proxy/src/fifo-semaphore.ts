import { logger } from "./logger.js";

/** A semaphore that grants permits in strict FIFO order. */
export class FifoSemaphore {
  #active = 0;
  readonly #limit: number;
  readonly #queue: Array<{ resolve: () => void; key: string }> = [];
  readonly #locks = new Map<string, number>();

  constructor(limit: number) {
    this.#limit = limit;
  }

  get active() {
    return this.#active;
  }

  get queued() {
    return this.#queue.length;
  }

  #locksSnapshot() {
    const now = Date.now();
    return [...this.#locks.entries()].map(([key, ts]) => ({
      key,
      ageMs: now - ts,
    }));
  }

  #log(event: string, key: string) {
    logger.info(`[gpu-semaphore] ${event}`, {
      key,
      active: this.#active,
      queued: this.#queue.length,
      locks: this.#locksSnapshot(),
    });
  }

  #releaseFor(key: string) {
    return () => {
      this.#active--;
      this.#locks.delete(key);
      this.#log("release", key);
      if (this.#queue.length > 0) {
        const next = this.#queue.shift()!;
        this.#active++;
        this.#locks.set(next.key, Date.now());
        this.#log("acquire-after-wait", next.key);
        next.resolve();
      }
    };
  }

  acquire(
    key: string,
  ):
    | { acquired: true; release: () => void }
    | { acquired: false; waiter: Promise<() => void>; cancel: () => void } {
    if (this.#locks.has(key) || this.#queue.some((e) => e.key === key)) {
      throw new Error(`Duplicate semaphore acquire for key: ${key}`);
    }

    if (this.#active < this.#limit) {
      this.#active++;
      this.#locks.set(key, Date.now());
      this.#log("acquire-instant", key);
      return { acquired: true, release: this.#releaseFor(key) };
    }

    this.#log("acquire-enqueued", key);

    let entry: { resolve: () => void; key: string };
    const waiter = new Promise<() => void>((resolve) => {
      entry = { resolve: () => resolve(this.#releaseFor(key)), key };
      this.#queue.push(entry);
    });

    const cancel = () => {
      const idx = this.#queue.indexOf(entry!);
      if (idx !== -1) {
        this.#queue.splice(idx, 1);
        this.#log("acquire-timeout", key);
      }
    };

    return { acquired: false, waiter, cancel };
  }
}
