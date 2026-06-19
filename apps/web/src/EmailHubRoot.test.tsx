import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmailHubRoot } from "./EmailHubRoot";
import type { EmailHubApi } from "./lib/emailHubApi";
import type {
  EmailHubSessionApi,
  EmailHubSessionDto,
} from "./lib/emailHubSessionTypes";

describe("EmailHubRoot", () => {
  it("creates the first admin from the home UI and enters the mailbox", async () => {
    const api = createAuthApiFixture({
      getSession: vi.fn(async () => ({
        authenticated: false,
        setupRequired: true,
      })),
      createAdmin: vi.fn(async () => ({
        authenticated: true,
        expiresAt: "2026-06-19T12:00:00.000Z",
        user: { email: "admin", role: "owner" as const },
      })),
    });

    render(
      <EmailHubRoot
        api={api}
        renderAuthenticatedApp={() => <div>邮箱工作台</div>}
      />,
    );

    expect(await screen.findByRole("heading", { name: "创建管理员" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("账号"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建管理员账户/ }));

    await waitFor(() => {
      expect(api.createAdmin).toHaveBeenCalledWith({
        email: "admin",
        password: "admin",
      });
    });
    expect(await screen.findByText("邮箱工作台")).toBeTruthy();
  });

  it("shows the login UI and enters the mailbox after login", async () => {
    const api = createAuthApiFixture({
      getSession: vi.fn(async () => ({
        authenticated: false,
        setupRequired: false,
      })),
      login: vi.fn(async () => ({
        authenticated: true,
        expiresAt: "2026-06-19T12:00:00.000Z",
        user: { email: "admin", role: "owner" as const },
      })),
    });

    render(
      <EmailHubRoot
        api={api}
        renderAuthenticatedApp={() => <div>邮箱工作台</div>}
      />,
    );

    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("账号"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登录 Email Hub/ }));

    await waitFor(() => {
      expect(api.login).toHaveBeenCalledWith({
        email: "admin",
        password: "admin",
      });
    });
    expect(await screen.findByText("邮箱工作台")).toBeTruthy();
  });

  it("restores an existing session and logs out through the session API", async () => {
    const api = createAuthApiFixture({
      getSession: vi.fn(async () => ({
        authenticated: true,
        expiresAt: "2026-06-19T12:00:00.000Z",
        user: { email: "lin@example.com", role: "owner" as const },
      })),
      logout: vi.fn(async () => ({ authenticated: false })),
    });

    render(
      <EmailHubRoot
        api={api}
        renderAuthenticatedApp={() => <div>邮箱工作台</div>}
      />,
    );

    expect(await screen.findByText("邮箱工作台")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => {
      expect(api.logout).toHaveBeenCalled();
    });
    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeTruthy();
  });

  it("enters the mailbox directly when web auth is disabled for testing", async () => {
    const api = createAuthApiFixture({
      getSession: vi.fn(async () => ({
        authenticated: true,
        authDisabled: true,
        expiresAt: "2026-06-19T12:00:00.000Z",
        user: { email: "admin", role: "owner" as const },
      })),
    });

    render(
      <EmailHubRoot
        api={api}
        renderAuthenticatedApp={() => <div>邮箱工作台</div>}
      />,
    );

    expect(await screen.findByText("邮箱工作台")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "欢迎回来" })).toBeNull();
    expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
    expect(api.login).not.toHaveBeenCalled();
  });

  it("keeps the session restore screen visually quiet", () => {
    const api = createAuthApiFixture({
      getSession: vi.fn(
        (): Promise<EmailHubSessionDto> => new Promise(() => undefined),
      ),
    });

    render(
      <EmailHubRoot
        api={api}
        renderAuthenticatedApp={() => <div>邮箱工作台</div>}
      />,
    );

    expect(screen.getByLabelText("Email Hub")).toBeTruthy();
    expect(screen.queryByText(/正在|加载|进入/)).toBeNull();
  });
});

function createAuthApiFixture(
  overrides: Partial<EmailHubApi & EmailHubSessionApi>,
): EmailHubApi & EmailHubSessionApi {
  return {
    getSession: vi.fn(async () => ({ authenticated: false })),
    createAdmin: vi.fn(async () => ({ authenticated: false })),
    login: vi.fn(async () => ({ authenticated: false })),
    logout: vi.fn(async () => ({ authenticated: false })),
    ...overrides,
  } as EmailHubApi & EmailHubSessionApi;
}
