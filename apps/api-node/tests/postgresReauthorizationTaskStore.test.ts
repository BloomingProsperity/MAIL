import { describe, expect, it } from "vitest";

import { createPostgresReauthorizationTaskStore } from "../src/accounts/postgres-reauthorization-task-store";

describe("postgres reauthorization task store", () => {
  it("loads only pending reauthorization task data", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "task_1",
              email: "boss@gmail.com",
              provider: "gmail",
              auth_method: "oauth",
              status: "pending",
              error_message: null,
              payload: {
                reauthRequired: true,
                loginHint: "boss@gmail.com",
                refreshToken: "must-not-leak",
              },
            },
          ],
        };
      },
    };

    const store = createPostgresReauthorizationTaskStore(client);
    const task = await store.getTask("task_1");

    expect(queries[0].text).toMatch(/FROM onboarding_tasks/i);
    expect(queries[0].text).toMatch(/payload ->> 'reauthRequired' = 'true'/i);
    expect(queries[0].text).not.toMatch(/stored_secrets|account_credentials/i);
    expect(queries[0].values).toEqual(["task_1"]);
    expect(task).toEqual({
      id: "task_1",
      email: "boss@gmail.com",
      provider: "gmail",
      authMethod: "oauth",
      status: "pending",
      payload: {
        reauthRequired: true,
        loginHint: "boss@gmail.com",
      },
    });
    expect(JSON.stringify(task)).not.toContain("must-not-leak");
  });

  it("updates OAuth session fields without writing secrets", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "task_1",
              email: "boss@gmail.com",
              provider: "gmail",
              auth_method: "oauth",
              status: "pending",
              error_message: null,
              payload: {
                reauthRequired: true,
                state: "state_1",
                redirectUri: "https://app.example.com/oauth/callback",
                loginHint: "boss@gmail.com",
              },
            },
          ],
        };
      },
    };

    const store = createPostgresReauthorizationTaskStore(client);
    const task = await store.updateOAuthSession({
      taskId: "task_1",
      session: {
        state: "state_1",
        redirectUri: "https://app.example.com/oauth/callback",
        loginHint: "boss@gmail.com",
      },
    });

    expect(queries[0].text).toMatch(/UPDATE onboarding_tasks/i);
    expect(queries[0].text).toMatch(/payload = payload \|\| \$2::jsonb/i);
    expect(queries[0].text).not.toMatch(/stored_secrets|account_credentials/i);
    expect(queries[0].values).toEqual([
      "task_1",
      {
        state: "state_1",
        redirectUri: "https://app.example.com/oauth/callback",
        loginHint: "boss@gmail.com",
      },
    ]);
    expect(JSON.stringify(queries[0].values)).not.toContain("secret");
    expect(task).toMatchObject({
      id: "task_1",
      email: "boss@gmail.com",
      provider: "gmail",
      authMethod: "oauth",
      status: "pending",
    });
  });
});
