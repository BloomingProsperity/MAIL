import { describe, expect, it } from "vitest";

import { GmailApiError } from "../src/google/gmail-api-client";
import { GraphApiError } from "../src/microsoft/graph-api-client";
import {
  createPostgresNativeSendReauthorizationMarker,
  createReauthorizationAwareNativeSendTransport,
} from "../src/mail-provider/native-send-reauthorization";
import type {
  ScheduledSendTransport,
} from "../src/scheduled-send-runner";

describe("worker native scheduled send reauthorization", () => {
  it("marks Gmail scheduled sends for reauthorization on provider auth failures", async () => {
    const marks: unknown[] = [];
    const transport = createReauthorizationAwareNativeSendTransport({
      provider: "gmail",
      delegate: failingTransport(
        new GmailApiError(
          "Gmail API request failed: 403 PERMISSION_DENIED missing scope",
          403,
          "PERMISSION_DENIED",
        ),
      ),
      marker: {
        async markRequired(input) {
          marks.push(input);
          return { taskId: "task_reauth_1" };
        },
      },
    });

    await expect(transport.submitMessage(scheduledMessage())).rejects.toThrow(
      "Gmail API request failed: 403 PERMISSION_DENIED missing scope",
    );
    expect(marks).toEqual([
      {
        accountId: "acc_1",
        provider: "gmail",
        reason: "Gmail 403 PERMISSION_DENIED",
      },
    ]);
  });

  it("does not mark transient provider failures", async () => {
    const marks: unknown[] = [];
    const transport = createReauthorizationAwareNativeSendTransport({
      provider: "graph",
      delegate: failingTransport(
        new GraphApiError(
          "Microsoft Graph request failed: 500 backendError",
          500,
          "backendError",
        ),
      ),
      marker: {
        async markRequired(input) {
          marks.push(input);
          return { taskId: "task_reauth_1" };
        },
      },
    });

    await expect(transport.submitMessage(scheduledMessage())).rejects.toThrow(
      "Microsoft Graph request failed: 500 backendError",
    );
    expect(marks).toEqual([]);
  });

  it("marks rejected OAuth refresh errors without marking worker config errors", async () => {
    const marks: unknown[] = [];
    const marker = {
      async markRequired(input: {
        accountId: string;
        provider: "gmail" | "outlook";
        reason: string;
      }) {
        marks.push(input);
        return { taskId: "task_reauth_1" };
      },
    };
    const authFailure = createReauthorizationAwareNativeSendTransport({
      provider: "graph",
      delegate: failingTransport(
        new Error(
          "Microsoft OAuth refresh failed: 400 invalid_grant refresh token rejected",
        ),
      ),
      marker,
    });
    const configFailure = createReauthorizationAwareNativeSendTransport({
      provider: "gmail",
      delegate: failingTransport(
        new Error(
          "GOOGLE_OAUTH_CLIENT_ID missing; cannot refresh Gmail access tokens",
        ),
      ),
      marker,
    });

    await expect(authFailure.submitMessage(scheduledMessage())).rejects.toThrow(
      "invalid_grant",
    );
    await expect(configFailure.submitMessage(scheduledMessage())).rejects.toThrow(
      "GOOGLE_OAUTH_CLIENT_ID missing",
    );
    expect(marks).toEqual([
      {
        accountId: "acc_1",
        provider: "outlook",
        reason:
          "Microsoft OAuth refresh failed: 400 invalid_grant refresh token rejected",
      },
    ]);
  });

  it("creates or reuses a native-send reauthorization task in Postgres", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const marker = createPostgresNativeSendReauthorizationMarker({
      client: {
        async query(text: string, values?: unknown[]) {
          queries.push({ text, values });
          return { rows: [{ task_id: "task_reauth_1" }] };
        },
      },
      createId: () => "task_reauth_1",
    });

    await expect(
      marker.markRequired({
        accountId: "acc_1",
        provider: "gmail",
        reason: "Gmail 401 UNAUTHENTICATED",
      }),
    ).resolves.toEqual({ taskId: "task_reauth_1" });

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/sync_state = 'reauth_required'/i);
    expect(queries[0].text).toMatch(/payload ->> 'reauthRequired'/);
    expect(queries[0].text).toMatch(/'source', 'native_send'/);
    expect(queries[0].values).toEqual([
      "acc_1",
      "task_reauth_1",
      "Gmail 401 UNAUTHENTICATED",
    ]);
  });
});

function failingTransport(error: Error): ScheduledSendTransport {
  return {
    async submitMessage() {
      throw error;
    },
  };
}

function scheduledMessage(): Parameters<ScheduledSendTransport["submitMessage"]>[0] {
  return {
    accountId: "acc_1",
    draftId: "draft_1",
    idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
    to: [{ address: "client@example.com" }],
    cc: [],
    bcc: [],
    subject: "Status",
    bodyText: "Ready",
  };
}
