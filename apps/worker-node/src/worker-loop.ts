export type WorkerLoopResult =
  | { status: string }
  | {
      status: "failed";
      laneIndex: number;
      laneName?: string;
      errorMessage: string;
    };

export type WorkerLoopLane =
  | (() => Promise<ReadonlyArray<WorkerLoopResult>>)
  | {
      name: string;
      run(): Promise<ReadonlyArray<WorkerLoopResult>>;
    };

export interface CreateWorkerLoopRunnerInput {
  lanes: WorkerLoopLane[];
}

export function createWorkerLoopRunner(input: CreateWorkerLoopRunnerInput) {
  let running = false;

  return async (): Promise<WorkerLoopResult[]> => {
    if (running) {
      return [{ status: "skipped" }];
    }

    running = true;
    try {
      const results: WorkerLoopResult[] = [];
      for (const [laneIndex, lane] of input.lanes.entries()) {
        try {
          results.push(...tagLaneResults(lane, await runLane(lane)));
        } catch (error) {
          const laneName = getLaneName(lane);
          results.push({
            status: "failed",
            laneIndex,
            ...(laneName ? { laneName } : {}),
            errorMessage:
              error instanceof Error ? error.message : "unknown lane error",
          });
        }
      }
      return results.length > 0 ? results : [{ status: "idle" }];
    } finally {
      running = false;
    }
  };
}

function runLane(lane: WorkerLoopLane): Promise<ReadonlyArray<WorkerLoopResult>> {
  return typeof lane === "function" ? lane() : lane.run();
}

function getLaneName(lane: WorkerLoopLane): string | undefined {
  return typeof lane === "function" ? undefined : lane.name;
}

function tagLaneResults(
  lane: WorkerLoopLane,
  results: ReadonlyArray<WorkerLoopResult>,
): WorkerLoopResult[] {
  const laneName = getLaneName(lane);
  if (!laneName) {
    return [...results];
  }

  return results.map((result) => ({ ...result, laneName }));
}
