import { describe, expect, it } from "vitest";
import { parseAccountCsv } from "./importCsv";

describe("parseAccountCsv", () => {
  it("validates mixed OAuth and auth-code account rows", () => {
    const csv = [
      "email,provider,display_name,auth_method,imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,username,secret,labels,group,enabled,sync_since,send_enabled,notes",
      "a@gmail.com,gmail,A,oauth,,,,,,,,,客户|工作,main,true,2026-01-01,true,",
      "b@qq.com,qq,B,app_password,imap.qq.com,993,tls,smtp.qq.com,465,tls,b@qq.com,secret,财务,cn,true,,true,",
      "broken@qq.com,qq,Broken,app_password,,,,,,,,,,true,,true,"
    ].join("\n");

    const result = parseAccountCsv(csv);

    expect(result.validRows).toHaveLength(2);
    expect(result.errors).toEqual([
      {
        row: 4,
        field: "imap_host",
        message: "IMAP/SMTP 账号必须填写服务器和授权码"
      }
    ]);
    expect(result.validRows[0].authMethod).toBe("oauth");
    expect(result.validRows[1].labels).toEqual(["财务"]);
  });

  it("accepts iCloud app-password rows without manual server columns", () => {
    const csv = [
      "email,provider,display_name,auth_method,imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,username,secret,labels,group,enabled,sync_since,send_enabled,notes",
      "me@icloud.com,icould,iCloud Mail,app_password,,,,,,,me@icloud.com,apple-app-password,personal,main,true,,true,use app-specific password"
    ].join("\n");

    const result = parseAccountCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.validRows).toEqual([
      {
        email: "me@icloud.com",
        provider: "icloud",
        displayName: "iCloud Mail",
        authMethod: "app_password",
        username: "me@icloud.com",
        secret: "apple-app-password",
        labels: ["personal"],
        group: "main",
        enabled: true,
        sendEnabled: true,
        notes: "use app-specific password"
      }
    ]);
  });
});
