/** A semaphore that grants permits in strict FIFO order. */
export class FifoSemaphore {
  #active = 0;
  readonly #limit: number;
  readonly #queue: Array<() => void> = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  get active() {
    return this.#active;
  }

  get queued() {
    return this.#queue.length;
  }

  #release = () => {
    this.#active--;
    if (this.#queue.length > 0) {
      this.#active++;
      this.#queue.shift()!();
    }
  };

  acquire(): { acquired: true; release: () => void } | { acquired: false; waiter: Promise<() => void>; cancel: () => void } {
    if (this.#active < this.#limit) {
      this.#active++;
      return { acquired: true, release: this.#release };
    }

    let entry: () => void;
    const waiter = new Promise<() => void>((resolve) => {
      entry = () => resolve(this.#release);
      this.#queue.push(entry);
    });

    const cancel = () => {
      const idx = this.#queue.indexOf(entry!);
      if (idx !== -1) this.#queue.splice(idx, 1);
    };

    return { acquired: false, waiter, cancel };
  }
}
