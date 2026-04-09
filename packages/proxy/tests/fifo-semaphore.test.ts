import assert from "node:assert";

import { FifoSemaphore } from "../src/fifo-semaphore.js";

describe("FifoSemaphore", () => {
  it("grants permits immediately when below the limit", () => {
    const sem = new FifoSemaphore(2);
    const a = sem.acquire("a");
    const b = sem.acquire("b");
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
    expect(sem.active).toBe(2);
  });

  it("queues when at the limit and grants on release", async () => {
    const sem = new FifoSemaphore(1);
    const a = sem.acquire("a");
    assert(a.acquired);

    const b = sem.acquire("b");
    expect(b.acquired).toBe(false);
    assert(!b.acquired);
    expect(sem.queued).toBe(1);

    a.release();
    const releaseB = await b.waiter;
    expect(sem.active).toBe(1);
    expect(sem.queued).toBe(0);
    releaseB();
  });

  it("grants queued permits in FIFO order", async () => {
    const sem = new FifoSemaphore(1);
    const a = sem.acquire("a");
    assert(a.acquired);

    const order: string[] = [];

    const b = sem.acquire("b");
    assert(!b.acquired);
    const bDone = b.waiter.then((release) => {
      order.push("B");
      return release;
    });

    const c = sem.acquire("c");
    assert(!c.acquired);
    const cDone = c.waiter.then((release) => {
      order.push("C");
      return release;
    });

    const d = sem.acquire("d");
    assert(!d.acquired);
    const dDone = d.waiter.then((release) => {
      order.push("D");
      return release;
    });

    // Release A — should wake B (first in queue)
    a.release();
    const releaseB = await bDone;
    expect(order).toEqual(["B"]);

    // Release B — should wake C
    releaseB();
    const releaseC = await cDone;
    expect(order).toEqual(["B", "C"]);

    // Release C — should wake D
    releaseC();
    const releaseD = await dDone;
    expect(order).toEqual(["B", "C", "D"]);

    releaseD();
    expect(sem.active).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it("cancel removes a waiter from the queue", () => {
    const sem = new FifoSemaphore(1);
    const a = sem.acquire("a");
    assert(a.acquired);

    const b = sem.acquire("b");
    assert(!b.acquired);
    const c = sem.acquire("c");
    assert(!c.acquired);

    expect(sem.queued).toBe(2);
    b.cancel();
    expect(sem.queued).toBe(1);

    // Releasing A should wake C (B was cancelled)
    const order: string[] = [];
    c.waiter.then(() => order.push("C"));

    a.release();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(order).toEqual(["C"]);
        expect(sem.active).toBe(1);
        resolve();
      }, 0);
    });
  });

  it("handles concurrency limit > 1", async () => {
    const sem = new FifoSemaphore(2);
    const a = sem.acquire("a");
    const b = sem.acquire("b");
    assert(a.acquired);
    assert(b.acquired);

    const order: string[] = [];
    const c = sem.acquire("c");
    assert(!c.acquired);
    const cDone = c.waiter.then((release) => {
      order.push("C");
      return release;
    });

    const d = sem.acquire("d");
    assert(!d.acquired);
    const dDone = d.waiter.then((release) => {
      order.push("D");
      return release;
    });

    // Release A — should wake C
    a.release();
    await cDone;
    expect(order).toEqual(["C"]);

    // Release B — should wake D
    b.release();
    await dDone;
    expect(order).toEqual(["C", "D"]);
  });
});
