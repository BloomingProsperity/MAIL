import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Globe2,
  Inbox,
  LockKeyhole,
  LogOut,
  Mail,
  MailPlus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { App } from "./App";
import type { EmailHubApi } from "./lib/emailHubApi";
import type {
  EmailHubSessionApi,
  EmailHubSessionDto,
} from "./lib/emailHubSessionTypes";
import "./EmailHubRoot.css";

type SessionState =
  | { status: "loading" }
  | { status: "anonymous"; setupRequired: boolean; notice?: string }
  | { status: "authenticated"; session: EmailHubSessionDto };

export interface EmailHubRootProps {
  api: EmailHubApi & EmailHubSessionApi;
  defaultAccountId?: string;
  restrictToDefaultAccount?: boolean;
  renderAuthenticatedApp?: () => ReactNode;
}

export function EmailHubRoot({
  api,
  defaultAccountId,
  restrictToDefaultAccount,
  renderAuthenticatedApp,
}: EmailHubRootProps) {
  const [sessionState, setSessionState] = useState<SessionState>({
    status: "loading",
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitPending, setSubmitPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const workspaceHost =
    typeof window === "undefined" ? "Email Hub" : window.location.host;

  useEffect(() => {
    let mounted = true;
    api
      .getSession()
      .then((session) => {
        if (!mounted) {
          return;
        }
        setSessionState(
          session.authenticated
            ? { status: "authenticated", session }
            : {
                status: "anonymous",
                setupRequired: Boolean(session.setupRequired),
              },
        );
      })
      .catch(() => {
        if (mounted) {
          setSessionState({
            status: "anonymous",
            setupRequired: false,
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, [api]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sessionState.status !== "anonymous" || submitPending) {
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    if (!trimmedEmail || !trimmedPassword) {
      setSessionState({
        ...sessionState,
        notice: "请填写账号和密码。",
      });
      return;
    }

    if (sessionState.setupRequired) {
      if (trimmedPassword.length < 4) {
        setSessionState({
          ...sessionState,
          notice: "管理员密码至少需要 4 位。",
        });
        return;
      }

      if (trimmedPassword !== confirmPassword.trim()) {
        setSessionState({
          ...sessionState,
          notice: "两次输入的密码不一致。",
        });
        return;
      }
    }

    setSubmitPending(true);
    try {
      const session = sessionState.setupRequired
        ? await api.createAdmin({
            email: trimmedEmail,
            password: trimmedPassword,
          })
        : await api.login({ email: trimmedEmail, password: trimmedPassword });
      if (!session.authenticated) {
        setSessionState({
          ...sessionState,
          notice: sessionState.setupRequired
            ? "管理员账户没有创建成功。"
            : "登录没有建立有效会话。",
        });
        return;
      }

      setPassword("");
      setConfirmPassword("");
      setSessionState({ status: "authenticated", session });
    } catch {
      setSessionState({
        ...sessionState,
        notice: sessionState.setupRequired
          ? "创建失败，请确认账号和密码格式。"
          : "登录失败，请检查账号和密码。",
      });
    } finally {
      setSubmitPending(false);
    }
  };

  const handleLogout = async () => {
    if (logoutPending) {
      return;
    }

    setLogoutPending(true);
    try {
      await api.logout();
    } finally {
      setLogoutPending(false);
      setPassword("");
      setConfirmPassword("");
      setSessionState({ status: "anonymous", setupRequired: false });
    }
  };

  if (sessionState.status === "loading") {
    return (
      <main className="auth-home auth-home-loading" aria-label="Email Hub">
        <div className="auth-loading-mark">
          <Mail aria-hidden="true" size={22} />
        </div>
      </main>
    );
  }

  if (sessionState.status === "authenticated") {
    const authDisabled = Boolean(sessionState.session.authDisabled);

    return (
      <div className="authenticated-root">
        {!authDisabled ? (
          <button
            className="session-logout-button"
            type="button"
            onClick={handleLogout}
            disabled={logoutPending}
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut aria-hidden="true" size={16} />
          </button>
        ) : null}
        {renderAuthenticatedApp?.() ?? (
          <App
            api={api}
            defaultAccountId={defaultAccountId}
            restrictToDefaultAccount={restrictToDefaultAccount}
          />
        )}
      </div>
    );
  }

  return (
    <main className="auth-home" aria-label="Email Hub 首页">
      <header className="auth-topbar">
        <div className="auth-brand">
          <span className="auth-brand-mark">
            <Mail aria-hidden="true" size={20} />
          </span>
          <span>
            <strong>Email Hub</strong>
            <small>统一邮件工作台</small>
          </span>
        </div>
        <div className="auth-status-pills" aria-label="产品亮点">
          <span>统一收件箱</span>
          <span>
            <ShieldCheck aria-hidden="true" size={15} />
            隐私保护
          </span>
          <span>智能辅助</span>
        </div>
      </header>

      <section className="auth-hero" aria-label="产品概览">
        <div className="auth-hero-copy">
          <span className="auth-kicker">
            <Sparkles aria-hidden="true" size={14} />
            统一邮箱 · Hermes 智能辅助
          </span>
          <h1>
            把所有邮箱，放回一个
            <strong>可信的工作台</strong>
          </h1>
          <p>
            统一收件箱、跨账号搜索、智能摘要与安全发送，把重要邮件集中处理。
          </p>
          <div className="auth-feature-row" aria-label="核心能力">
            <span>
              <Inbox aria-hidden="true" size={16} />
              多账号统一处理
            </span>
            <span>
              <FileText aria-hidden="true" size={16} />
              私密数据保护
            </span>
            <span>
              <ShieldCheck aria-hidden="true" size={16} />
              AI 操作先预览
            </span>
          </div>
        </div>

        <WorkbenchPreview />
      </section>

      <AuthPanel
        email={email}
        password={password}
        confirmPassword={confirmPassword}
        setupRequired={sessionState.setupRequired}
        workspaceHost={workspaceHost}
        notice={sessionState.notice}
        submitPending={submitPending}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onSubmit={handleSubmit}
      />

      <footer className="auth-footer">
        <span>© 2026 Email Hub</span>
      </footer>
    </main>
  );
}

function AuthPanel({
  email,
  password,
  confirmPassword,
  setupRequired,
  workspaceHost,
  notice,
  submitPending,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
}: {
  email: string;
  password: string;
  confirmPassword: string;
  setupRequired: boolean;
  workspaceHost: string;
  notice?: string;
  submitPending: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const actionLabel = setupRequired ? "创建管理员账户" : "登录 Email Hub";

  return (
    <section className="auth-panel" aria-label={setupRequired ? "创建管理员" : "登录"}>
      <div className="auth-panel-accent" aria-hidden="true" />
      <div className="auth-panel-heading">
        <h2>{setupRequired ? "创建管理员" : "欢迎回来"}</h2>
        <p>
          {setupRequired
            ? "创建账户后即可进入 Email Hub。"
            : "登录后查看所有邮箱。"}
        </p>
      </div>

      {!setupRequired ? (
        <div className="auth-workspace-card">
          <span>
            <FileText aria-hidden="true" size={24} />
          </span>
          <div>
            <small>当前地址</small>
            <strong>{workspaceHost}</strong>
          </div>
          <em>
            <CheckCircle2 aria-hidden="true" size={12} />
            当前访问
          </em>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="auth-form">
        <label>
          <span>账号</span>
          <div className="auth-input-shell">
            <Mail aria-hidden="true" size={17} />
            <input
              type="text"
              value={email}
              onChange={(event) => onEmailChange(event.currentTarget.value)}
              autoComplete="username"
              placeholder="admin"
            />
          </div>
        </label>

        <label>
          <span>密码</span>
          <div className="auth-input-shell">
            <LockKeyhole aria-hidden="true" size={17} />
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.currentTarget.value)}
              autoComplete={setupRequired ? "new-password" : "current-password"}
              placeholder={setupRequired ? "至少 4 位" : "输入密码"}
            />
          </div>
        </label>

        {setupRequired ? (
          <label>
            <span>确认密码</span>
            <div className="auth-input-shell">
              <LockKeyhole aria-hidden="true" size={17} />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  onConfirmPasswordChange(event.currentTarget.value)
                }
                autoComplete="new-password"
                placeholder="再次输入密码"
              />
            </div>
          </label>
        ) : (
          <div className="auth-form-options">
            <label>
              <input type="checkbox" defaultChecked />
              <span>在此设备保持登录</span>
            </label>
          </div>
        )}

        {notice ? (
          <p className="auth-notice" role="status">
            {notice}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!email.trim() || !password.trim() || submitPending}
        >
          {submitPending ? "处理中" : actionLabel}
          <ArrowRight aria-hidden="true" size={18} />
        </button>
      </form>

    </section>
  );
}

function WorkbenchPreview() {
  return (
    <section className="auth-workbench" aria-label="邮箱工作台预览">
      <header className="auth-window-bar">
        <span />
        <span />
        <span />
        <div>
          <Search aria-hidden="true" size={15} />
          搜索邮件、联系人或附件
        </div>
        <em>林</em>
      </header>

      <div className="auth-workbench-body">
        <aside className="auth-workbench-sidebar">
          <div className="auth-mini-brand">
            <Mail aria-hidden="true" size={20} />
            <strong>Email Hub</strong>
          </div>
          <nav aria-label="预览导航">
            <span className="active">
              <Inbox aria-hidden="true" size={15} />
              邮箱
              <strong>18</strong>
            </span>
            <span>
              <MailPlus aria-hidden="true" size={15} />
              添加邮箱
            </span>
            <span>
              <Search aria-hidden="true" size={15} />
              搜索
            </span>
            <span>
              <Sparkles aria-hidden="true" size={15} />
              Hermes
            </span>
            <span>
              <Globe2 aria-hidden="true" size={15} />
              配置域名
            </span>
            <span>
              <Settings aria-hidden="true" size={15} />
              设置
            </span>
          </nav>
          <small>
            <CheckCircle2 aria-hidden="true" size={12} />
            在线
          </small>
        </aside>

        <div className="auth-message-column">
          <header>
            <strong>收件箱</strong>
            <button type="button">智能排序</button>
          </header>
          {previewMessages.map((message) => (
            <article
              className={message.active ? "active" : undefined}
              key={message.sender}
            >
              <span>
                <strong>{message.sender}</strong>
                <small>{message.subject}</small>
              </span>
              <time>{message.time}</time>
              <em>{message.label}</em>
            </article>
          ))}
        </div>

        <div className="auth-reader-preview">
          <header>
            <span>客户 · Q2 合作</span>
            <strong>确认 Q2 合作方案与交付时间</strong>
          </header>
          <div className="auth-sender-row">
            <span>周</span>
            <div>
              <strong>周敏</strong>
              <small>zhoumin@xinghai.design · 发给我</small>
            </div>
          </div>
          <div className="auth-hermes-card">
            <span>
              <Sparkles aria-hidden="true" size={14} />
              Hermes 摘要
            </span>
            <p>
              客户已确认方案，希望今天 17:00 前补充里程碑与最终报价。建议先回复并附上两份材料。
            </p>
          </div>
          <div className="auth-reader-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="auth-attachment-row">
            <span>PDF</span>
            <strong>Q2 合作方案.pdf</strong>
            <small>1.2 MB</small>
          </div>
          <div className="auth-command-bar">
            <span>问问 Hermes</span>
            <button type="button" aria-label="发送">
              <Send aria-hidden="true" size={15} />
            </button>
          </div>
          <div className="auth-stats-card">
            <span>今日收件箱概览</span>
            <strong>已同步</strong>
            <div>
              <em>18<small>未读</small></em>
              <em>4<small>待回复</small></em>
              <em>2<small>后续</small></em>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const previewMessages = [
  {
    sender: "周敏 · 星海设计",
    subject: "确认 Q2 合作方案与交付时间",
    time: "09:42",
    label: "今天 17:00 截止",
    active: true,
  },
  {
    sender: "运营周报",
    subject: "本周重点数据已整理",
    time: "08:17",
    label: "周报",
    active: false,
  },
  {
    sender: "财务部",
    subject: "五月费用报销补充材料",
    time: "昨天",
    label: "待回复",
    active: false,
  },
  {
    sender: "Product Weekly",
    subject: "本周产品设计与 AI 动态",
    time: "周三",
    label: "Newsletter",
    active: false,
  },
];
