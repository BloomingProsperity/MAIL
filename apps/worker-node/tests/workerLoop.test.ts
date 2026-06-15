import { describe, expect, it, vi } from "vitest";

describe("worker loop runner", () => {
  it("skips every lane while a previous tick is still running", async () => {
    const module = await import("../src/worker-loop").catch(() => undefined);
    expect(module?.createWorkerLoopRunner).toBeTypeOf("function");

    if (!module?.createWorkerLoopRunner) {
      return;
    }

    const firstLaneStarted = deferred<void>();
    const releaseFirstLane = deferred<void>();
    const firstLane = vi.fn(async () => {
      firstLaneStarted.resolve();
      await releaseFirstLane.promise;
      return [{ status: "processed", lane: "sync" }];
    });
    const secondLane = vi.fn(async () => [
      { status: "processed", lane: "commands" },
    ]);
    const runTick = module.createWorkerLoopRunner({
      lanes: [firstLane, secondLane],
    });

    const firstTick = runTick();
    await firstLaneStarted.promise;

    await expect(runTick()).resolves.toEqual([{ status: "skipped" }]);
    expect(firstLane).toHaveBeenCalledTimes(1);
    expect(secondLane).not.toHaveBeenCalled();

    releaseFirstLane.resolve();

    await expect(firstTick).resolves.toEqual([
      { status: "processed", lane: "sync" },
      { status: "processed", lane: "commands" },
    ]);
    expect(secondLane).toHaveBeenCalledTimes(1);
  });

  it("continues later lanes when one lane fails", async () => {
    const module = await import("../src/worker-loop");
    const firstLane = vi.fn(async () => {
      throw new Error("sync lane database timeout");
    });
    const secondLane = vi.fn(async () => [
      { status: "processed", lane: "commands" },
    ]);
    const runTick = module.createWorkerLoopRunner({
      lanes: [firstLane, secondLane],
    });

    await expect(runTick()).resolves.toEqual([
      {
        status: "failed",
        laneIndex: 0,
        errorMessage: "sync lane database timeout",
      },
      { status: "processed", lane: "commands" },
    ]);
    expect(firstLane).toHaveBeenCalledTimes(1);
    expect(secondLane).toHaveBeenCalledTimes(1);
  });

  it("includes the lane name when a named lane fails", async () => {
    const module = await import("../src/worker-loop");
    const syncLane = vi.fn(async () => {
      throw new Error("database connection reset");
    });
    const commandLane = vi.fn(async () => [
      { status: "processed", lane: "engine_commands" },
    ]);
    const runTick = module.createWorkerLoopRunner({
      lanes: [
        { name: "sync", run: syncLane },
        { name: "engine_commands", run: commandLane },
      ],
    });

    await expect(runTick()).resolves.toEqual([
      {
        status: "failed",
        laneIndex: 0,
        laneName: "sync",
        errorMessage: "database connection reset",
      },
      {
        status: "processed",
        lane: "engine_commands",
        laneName: "engine_commands",
      },
    ]);
    expect(syncLane).toHaveBeenCalledTimes(1);
    expect(commandLane).toHaveBeenCalledTimes(1);
  });

  it("adds the lane name to every result from a named lane", async () => {
    const module = await import("../src/worker-loop");
    const commandLane = vi.fn(async () => [
      { status: "processed", commandId: "cmd_1" },
      { status: "failed", commandId: "cmd_2", errorMessage: "retry later" },
    ]);
    const runTick = module.createWorkerLoopRunner({
      lanes: [{ name: "engine_commands", run: commandLane }],
    });

    await expect(runTick()).resolves.toEqual([
      {
        status: "processed",
        commandId: "cmd_1",
        laneName: "engine_commands",
      },
      {
        status: "failed",
        commandId: "cmd_2",
        errorMessage: "retry later",
        laneName: "engine_commands",
      },
    ]);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T | PromiseLike<T>): void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
