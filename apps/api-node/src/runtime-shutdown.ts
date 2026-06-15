export interface RuntimeShutdownResource {
  name: string;
  close(): Promise<void> | void;
}

export interface RuntimeShutdownLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface CreateRuntimeShutdownHandlerInput {
  logger: RuntimeShutdownLogger;
  resources: RuntimeShutdownResource[];
  exit?: (code: number) => void;
}

export function createRuntimeShutdownHandler(
  input: CreateRuntimeShutdownHandlerInput,
) {
  const exit = input.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  return async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      input.logger.warn("runtime_shutdown_already_running", { signal });
      exit(1);
      return;
    }

    shuttingDown = true;
    input.logger.info("runtime_shutdown_started", {
      signal,
      resourceCount: input.resources.length,
    });

    const failures: Array<{ resource: string; errorMessage: string }> = [];
    for (const resource of input.resources) {
      try {
        input.logger.info("runtime_shutdown_resource_closing", {
          signal,
          resource: resource.name,
        });
        await resource.close();
        input.logger.info("runtime_shutdown_resource_closed", {
          signal,
          resource: resource.name,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "unknown shutdown error";
        failures.push({ resource: resource.name, errorMessage });
        input.logger.error("runtime_shutdown_resource_failed", {
          signal,
          resource: resource.name,
          errorMessage,
        });
      }
    }

    if (failures.length > 0) {
      input.logger.error("runtime_shutdown_failed", { signal, failures });
      exit(1);
      return;
    }

    input.logger.info("runtime_shutdown_completed", { signal });
    exit(0);
  };
}
