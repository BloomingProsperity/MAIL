import { describe, expect, it } from "vitest";

import {
  createAccountCsvImportService,
  InvalidCsvImportError,
} from "../src/accounts/csv-import";
import { createInMemoryAccountOnboardingStore } from "../src/accounts/imap-smtp-onboarding";

describe("account CSV import service", () => {
  it("previews supported bulk rows and rejects web-login mailboxes without creating tasks", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createAccountCsvImportService({
      store,
      createId: (() => {
        const ids = ["task_1", "task_2"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    const preview = await service.previewCsv({ csv: sampleCsv() });

    expect(preview.summary).toEqual({
      totalRows: 4,
      ready: 1,
      needsOAuth: 0,
      disabled: 1,
      invalid: 2,
    });
    expect(preview.rows.map((row) => row.status)).toEqual([
      "ready",
      "invalid",
      "disabled",
      "invalid",
    ]);
    expect(preview.rows[1].errors).toEqual([
      "gmail must be added with web login, not CSV import",
    ]);
    expect(preview.rows[3].errors).toEqual([
      "outlook must be added with web login, not CSV import",
    ]);
    expect(store.listTasks()).toEqual([]);
  });

  it("creates onboarding tasks only for supported bulk rows and redacts secrets", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createAccountCsvImportService({
      store,
      createId: (() => {
        const ids = ["task_password"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    const result = await service.createImport({ csv: sampleCsv() });

    expect(result.createdTaskCount).toBe(1);
    expect(result.summary).toMatchObject({
      ready: 1,
      needsOAuth: 0,
      disabled: 1,
      invalid: 2,
    });
    expect(result.tasks).toEqual([
      {
        rowNumber: 2,
        id: "task_password",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        status: "pending",
      },
    ]);
    expect(JSON.stringify(result.tasks)).not.toContain("payload");
    expect(JSON.stringify(result.tasks)).not.toContain("imap-auth-code");
    expect(store.listTasks()).toEqual([
      {
        id: "task_password",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        status: "pending",
        payload: {
          source: "csv_import",
          displayName: "Support",
          labels: ["support", "vip"],
          group: "ops",
          notes: "primary support",
          imap: {
            host: "imap.qq.com",
            port: 993,
            secure: true,
            username: "support@qq.com",
            secret: "[redacted]",
          },
          smtp: {
            host: "smtp.qq.com",
            port: 465,
            secure: true,
            username: "support@qq.com",
            secret: "[redacted]",
          },
        },
      },
    ]);
  });

  it("creates iCloud import tasks from the provider preset and app-specific password", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createAccountCsvImportService({
      store,
      createId: () => "task_icloud",
    });

    const result = await service.createImport({
      csv: [
        "email,provider,display_name,auth_method,username,secret,enabled,notes",
        "me@icloud.com,icloud,iCloud Mail,app_password,me@icloud.com,apple-app-specific-password,true,use Apple app-specific password",
      ].join("\n"),
    });

    expect(result.summary).toEqual({
      totalRows: 1,
      ready: 1,
      needsOAuth: 0,
      disabled: 0,
      invalid: 0,
    });
    expect(store.listTasks()).toEqual([
      {
        id: "task_icloud",
        email: "me@icloud.com",
        provider: "icloud",
        authMethod: "password",
        status: "pending",
        payload: {
          source: "csv_import",
          displayName: "iCloud Mail",
          labels: [],
          notes: "use Apple app-specific password",
          providerPreset: "icloud",
          imap: {
            host: "imap.mail.me.com",
            port: 993,
            secure: true,
            username: "me@icloud.com",
            secret: "[redacted]",
          },
          smtp: {
            host: "smtp.mail.me.com",
            port: 587,
            secure: false,
            username: "me@icloud.com",
            secret: "[redacted]",
          },
        },
      },
    ]);
  });

  it("normalizes iCloud aliases in CSV import rows", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createAccountCsvImportService({
      store,
      createId: () => "task_icloud",
    });

    const result = await service.createImport({
      csv: [
        "email,provider,display_name,auth_method,username,secret,enabled",
        "me@icloud.com,icould,iCloud Mail,app_password,me@icloud.com,apple-app-specific-password,true",
      ].join("\n"),
    });

    expect(result.summary).toMatchObject({
      ready: 1,
      invalid: 0,
    });
    expect(store.listTasks()).toMatchObject([
      {
        id: "task_icloud",
        email: "me@icloud.com",
        provider: "icloud",
        payload: {
          providerPreset: "icloud",
          imap: { host: "imap.mail.me.com", secret: "[redacted]" },
          smtp: { host: "smtp.mail.me.com", secret: "[redacted]" },
        },
      },
    ]);
  });

  it("creates 163, QQ, and Proton Bridge import tasks from provider presets", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createAccountCsvImportService({
      store,
      createId: (() => {
        const ids = ["task_163", "task_qq", "task_proton"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    const result = await service.createImport({
      csv: [
        "email,provider,display_name,auth_method,username,secret,enabled,notes",
        "archive@163.com,163,NetEase 163,authorization_code,archive@163.com,netease-auth-code,true,use 163 authorization code",
        "support@qq.com,qq,QQ Mail,authorization_code,support@qq.com,qq-auth-code,true,use QQ authorization code",
        "me@proton.me,proton_bridge,Proton Bridge,password,bridge-user,bridge-password,true,local Proton Bridge only",
      ].join("\n"),
    });

    expect(result.summary).toEqual({
      totalRows: 3,
      ready: 3,
      needsOAuth: 0,
      disabled: 0,
      invalid: 0,
    });
    expect(store.listTasks()).toMatchObject([
      {
        id: "task_163",
        email: "archive@163.com",
        provider: "163",
        payload: {
          providerPreset: "163",
          imap: {
            host: "imap.163.com",
            port: 993,
            secure: true,
            username: "archive@163.com",
            secret: "[redacted]",
          },
          smtp: {
            host: "smtp.163.com",
            port: 465,
            secure: true,
            username: "archive@163.com",
            secret: "[redacted]",
          },
        },
      },
      {
        id: "task_qq",
        email: "support@qq.com",
        provider: "qq",
        payload: {
          providerPreset: "qq",
          imap: {
            host: "imap.qq.com",
            port: 993,
            secure: true,
            username: "support@qq.com",
            secret: "[redacted]",
          },
          smtp: {
            host: "smtp.qq.com",
            port: 465,
            secure: true,
            username: "support@qq.com",
            secret: "[redacted]",
          },
        },
      },
      {
        id: "task_proton",
        email: "me@proton.me",
        provider: "proton_bridge",
        payload: {
          providerPreset: "proton_bridge",
          imap: {
            host: "127.0.0.1",
            port: 1143,
            secure: false,
            username: "bridge-user",
            secret: "[redacted]",
          },
          smtp: {
            host: "127.0.0.1",
            port: 1025,
            secure: false,
            username: "bridge-user",
            secret: "[redacted]",
          },
        },
      },
    ]);
  });

  it("stores Docker Proton Bridge overrides in CSV import tasks", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createAccountCsvImportService({
      store,
      createId: () => "task_proton",
      providerPresetOverrides: {
        proton_bridge: {
          imap: { host: "host.docker.internal", port: 2143, secure: false },
          smtp: { host: "host.docker.internal", port: 2025, secure: false },
        },
      },
    });

    const result = await service.createImport({
      csv: [
        "email,provider,display_name,auth_method,username,secret,enabled",
        "me@proton.me,proton,Proton Bridge,password,bridge-user,bridge-password,true",
      ].join("\n"),
    });

    expect(result.summary).toMatchObject({ ready: 1, invalid: 0 });
    expect(store.listTasks()).toMatchObject([
      {
        id: "task_proton",
        provider: "proton_bridge",
        payload: {
          providerPreset: "proton_bridge",
          imap: {
            host: "host.docker.internal",
            port: 2143,
            secure: false,
            username: "bridge-user",
            secret: "[redacted]",
          },
          smtp: {
            host: "host.docker.internal",
            port: 2025,
            secure: false,
            username: "bridge-user",
            secret: "[redacted]",
          },
        },
      },
    ]);
  });

  it("rejects malformed CSV before creating tasks", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createAccountCsvImportService({
      store,
      createId: () => "task_1",
    });

    await expect(
      service.createImport({ csv: "email,provider\nsupport@qq.com" }),
    ).rejects.toBeInstanceOf(InvalidCsvImportError);
    expect(store.listTasks()).toEqual([]);
  });
});

function sampleCsv(): string {
  return [
    "email,provider,display_name,auth_method,imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,username,secret,labels,group,enabled,notes",
    "support@qq.com,qq,Support,password,imap.qq.com,993,tls,smtp.qq.com,465,tls,support@qq.com,imap-auth-code,\"support; vip\",ops,true,primary support",
    "boss@gmail.com,gmail,Boss,oauth,,,,,,,,,,leadership,true,authorize interactively",
    "archive@163.com,163,Archive,password,imap.163.com,993,tls,smtp.163.com,465,tls,archive@163.com,secret,,archive,false,disabled for now",
    "sales@outlook.com,outlook,Sales,password,outlook.office365.com,993,tls,smtp.office365.com,587,starttls,sales@outlook.com,secret,,sales,true,wrong auth method",
  ].join("\n");
}
