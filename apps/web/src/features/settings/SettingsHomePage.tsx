import { useState } from "react";
import {
  Bell,
  ChevronDown,
  Globe2,
  Inbox,
  MailPlus,
  PanelRight,
  PenLine,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EmailHubApi } from "../../lib/emailHubApi";
import { ComposeAttachmentMaintenancePanel } from "../maintenance/ComposeAttachmentMaintenancePanel";
import { SystemStatusSettingsPanel } from "./SystemStatusSettingsPanel";
import "./SettingsAdmin.css";

interface SettingsHomePageProps {
  api?: EmailHubApi;
  connectedAccountCount: number;
  onOpenAddMail: () => void;
  onOpenDomains: () => void;
  onOpenHermes: () => void;
}

interface SettingsRow {
  title: string;
  description: string;
  value: string;
  icon: LucideIcon;
  action?: {
    label: string;
    onClick: () => void;
  };
}

type SettingsSectionId =
  | "accounts"
  | "mailbox"
  | "compose"
  | "connections"
  | "maintenance";

interface SettingsSectionModel {
  id: SettingsSectionId;
  title: string;
  summary: string;
  icon: LucideIcon;
  rows: SettingsRow[];
}

export function SettingsHomePage(props: SettingsHomePageProps) {
  const [activeSectionId, setActiveSectionId] =
    useState<SettingsSectionId>("accounts");
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const sections = settingsSections(props);
  const activeSection =
    sections.find((section) => section.id === activeSectionId) ?? sections[0];
  const ActiveIcon = activeSection.icon;

  return (
    <section className="workspace-page page-scroll settings-home-page">
      <header className="topbar single">
        <div>
          <h1>设置</h1>
        </div>
      </header>

      <div className="settings-home-layout">
        <nav className="settings-home-nav" aria-label="设置分类">
          {sections.map((section) => {
            const SectionIcon = section.icon;
            const selected = activeSection.id === section.id;

            return (
              <button
                className={selected ? "active" : ""}
                type="button"
                key={section.id}
                aria-current={selected ? "page" : undefined}
                onClick={() => {
                  setActiveSectionId(section.id);
                  setMaintenanceOpen(false);
                }}
              >
                <SectionIcon size={18} />
                <span>{section.title}</span>
                <small>{section.summary}</small>
              </button>
            );
          })}
        </nav>

        <section
          className="settings-home-detail"
          aria-label={`${activeSection.title}设置`}
        >
          <header className="settings-home-detail-head">
            <div className="settings-home-row-icon">
              <ActiveIcon size={18} />
            </div>
            <div>
              <h2>{activeSection.title}</h2>
              <span>{activeSection.summary}</span>
            </div>
          </header>

          {activeSection.id === "maintenance" ? (
            <MaintenanceSettingsSection
              api={props.api}
              open={maintenanceOpen}
              rows={activeSection.rows}
              onToggle={() => setMaintenanceOpen((current) => !current)}
            />
          ) : (
            <SettingsList rows={activeSection.rows} />
          )}
        </section>
      </div>
    </section>
  );
}

function settingsSections(props: SettingsHomePageProps): SettingsSectionModel[] {
  return [
    {
      id: "accounts",
      title: "邮箱账号",
      summary: `${props.connectedAccountCount} 个邮箱`,
      icon: MailPlus,
      rows: [
        {
          title: "已连接邮箱",
          description: "Gmail、Outlook、iCloud、QQ 和个人域名账号",
          value: `${props.connectedAccountCount} 个`,
          icon: MailPlus,
          action: {
            label: "查看",
            onClick: props.onOpenAddMail,
          },
        },
        {
          title: "添加邮箱",
          description: "网页登录或填写邮箱必要信息",
          value: "可添加",
          icon: Inbox,
          action: {
            label: "打开",
            onClick: props.onOpenAddMail,
          },
        },
        {
          title: "域名账号",
          description: "自有域名收信与发信别名",
          value: "可配置",
          icon: Globe2,
          action: {
            label: "配置",
            onClick: props.onOpenDomains,
          },
        },
      ],
    },
    {
      id: "mailbox",
      title: "收件箱",
      summary: "三栏布局",
      icon: PanelRight,
      rows: [
        {
          title: "收件箱布局",
          description: "文件夹、邮件列表、阅读窗格",
          value: "三栏",
          icon: PanelRight,
        },
        {
          title: "分类与标签",
          description: "验证码、发票、订阅、待回复和大附件",
          value: "邮箱页",
          icon: Tags,
        },
        {
          title: "搜索入口",
          description: "发件人、收件人、主题和正文",
          value: "顶部",
          icon: Search,
        },
      ],
    },
    {
      id: "compose",
      title: "撰写与阅读",
      summary: "浮动写信",
      icon: PenLine,
      rows: [
        {
          title: "撰写窗口",
          description: "新邮件使用浮动窗口",
          value: "浮动",
          icon: PenLine,
        },
        {
          title: "阅读窗格",
          description: "邮件内容固定在右侧",
          value: "右侧",
          icon: Inbox,
        },
        {
          title: "提醒",
          description: "重要邮件与待处理事项",
          value: "已启用",
          icon: Bell,
        },
      ],
    },
    {
      id: "connections",
      title: "连接",
      summary: "Hermes 与域名",
      icon: Sparkles,
      rows: [
        {
          title: "Hermes",
          description: "助手名称、服务商和连接检查",
          value: "可配置",
          icon: Sparkles,
          action: {
            label: "设置",
            onClick: props.onOpenHermes,
          },
        },
        {
          title: "域名与别名",
          description: "收信域名和发信别名",
          value: "配置域名",
          icon: Globe2,
          action: {
            label: "配置",
            onClick: props.onOpenDomains,
          },
        },
        {
          title: "账号安全",
          description: "授权与邮箱访问权限",
          value: "账号级",
          icon: ShieldCheck,
        },
      ],
    },
    {
      id: "maintenance",
      title: "状态与维护",
      summary: "按需查看",
      icon: Settings,
      rows: [
        {
          title: "运行状态",
          description: "服务连接与数据存储",
          value: "可查看",
          icon: ShieldCheck,
        },
        {
          title: "同步记录",
          description: "最近邮箱同步活动",
          value: "可查看",
          icon: Bell,
        },
        {
          title: "存储维护",
          description: "临时附件和过期记录清理",
          value: "可维护",
          icon: Settings,
        },
      ],
    },
  ];
}

function MaintenanceSettingsSection(props: {
  api?: EmailHubApi;
  open: boolean;
  rows: SettingsRow[];
  onToggle: () => void;
}) {
  return (
    <>
      <SettingsList rows={props.rows} />

      <section
        className="settings-admin-section settings-admin-drawer"
        aria-label="维护项目"
      >
        <button
          className="settings-admin-heading"
          type="button"
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <Settings size={18} />
          <h2>维护项目</h2>
          <span>状态、同步、存储</span>
          <ChevronDown
            className={
              props.open
                ? "settings-admin-chevron is-open"
                : "settings-admin-chevron"
            }
            size={18}
          />
        </button>
        {props.open ? (
          <div className="settings-admin-body">
            <SystemStatusSettingsPanel api={props.api} />
            <ComposeAttachmentMaintenancePanel api={props.api} />
          </div>
        ) : null}
      </section>
    </>
  );
}

function SettingsList(props: { rows: SettingsRow[] }) {
  return (
    <div className="settings-home-list">
      {props.rows.map((row) => (
        <SettingsListRow key={row.title} row={row} />
      ))}
    </div>
  );
}

function SettingsListRow(props: { row: SettingsRow }) {
  const Icon = props.row.icon;

  return (
    <article className="settings-home-row">
      <div className="settings-home-row-icon">
        <Icon size={18} />
      </div>
      <div>
        <strong>{props.row.title}</strong>
        <span>{props.row.description}</span>
      </div>
      <div className="settings-home-row-action">
        <span>{props.row.value}</span>
        {props.row.action ? (
          <button type="button" onClick={props.row.action.onClick}>
            {props.row.action.label}
          </button>
        ) : null}
      </div>
    </article>
  );
}
