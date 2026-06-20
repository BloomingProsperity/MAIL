import type { Dispatch, FormEvent, HTMLAttributes, SetStateAction } from "react";
import {
  Archive,
  Clock3,
  FileText,
  Inbox,
  Mail,
  Paperclip,
  PenLine,
  Send,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react";

import { mailItemKey } from "./mail-items";
import type { MailItem } from "./mail-items";
import type {
  FolderItem,
  LabelItem,
  MailDensity,
  QuickCategory,
} from "./MailWorkspaceTypes";

const densityOptions: Array<{ id: MailDensity; label: string; shortLabel: string }> = [
  { id: "roomy", label: "宽阔", shortLabel: "宽" },
  { id: "comfortable", label: "舒适", shortLabel: "舒" },
  { id: "compact", label: "紧凑", shortLabel: "紧" },
];

const folderIcons: Record<string, typeof Inbox> = {
  inbox: Inbox,
  flagged: Star,
  priority: Clock3,
  starred: Star,
  snoozed: Clock3,
  drafts: FileText,
  sent: Send,
  archive: Archive,
  junk: ShieldCheck,
  spam: ShieldCheck,
  trash: Trash2,
  all: Mail,
  attachments: Paperclip,
};

interface MailDirectoryListPanesProps {
  activeFolder: string;
  activeMailId: string;
  folders: FolderItem[];
  labels: LabelItem[];
  quickCategories: QuickCategory[];
  mail: MailItem[];
  density: MailDensity;
  folderTitle: string;
  folderCount: number;
  labelFormOpen: boolean;
  setLabelFormOpen: Dispatch<SetStateAction<boolean>>;
  newLabelName: string;
  setNewLabelName: (value: string) => void;
  labelNotice: string;
  setLabelNotice: (value: string) => void;
  labelBusy: boolean;
  selectedMailKeys: Set<string>;
  allVisibleSelected: boolean;
  selectedVisibleMail: MailItem[];
  directorySeparatorProps: HTMLAttributes<HTMLDivElement>;
  messageListSeparatorProps: HTMLAttributes<HTMLDivElement>;
  openNewComposeSurface: () => void;
  onRefresh: () => void;
  onFolderChange: (id: string) => void;
  onLabelChange: (id: string) => void;
  onSavedViewChange: (id: string) => void;
  onDensityChange: (density: MailDensity) => void;
  onMailChange: (id: string) => void;
  submitNewLabel: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  toggleAllVisibleMail: (checked: boolean) => void;
  toggleVisibleMail: (mail: MailItem, checked: boolean) => void;
}

export function MailDirectoryListPanes(props: MailDirectoryListPanesProps) {
  const {
    activeFolder,
    activeMailId,
    folders,
    labels,
    quickCategories,
    mail,
    density,
    folderTitle,
    folderCount,
    labelFormOpen,
    setLabelFormOpen,
    newLabelName,
    setNewLabelName,
    labelNotice,
    setLabelNotice,
    labelBusy,
    selectedMailKeys,
    allVisibleSelected,
    selectedVisibleMail,
    directorySeparatorProps,
    messageListSeparatorProps,
    openNewComposeSurface,
    onRefresh,
    onFolderChange,
    onLabelChange,
    onSavedViewChange,
    onDensityChange,
    onMailChange,
    submitNewLabel,
    toggleAllVisibleMail,
    toggleVisibleMail,
  } = props;

  return (
    <>
        <aside className="mail-directory" aria-label="邮箱目录栏">
          <div className="directory-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="写邮件"
              onClick={openNewComposeSurface}
            >
              <PenLine size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="刷新邮箱列表"
              onClick={onRefresh}
            >
              <Clock3 size={18} />
            </button>
          </div>

          <div className="directory-section">
            <div className="section-label">所有邮箱</div>
            {folders.map((folder) => {
              const Icon = folderIcons[folder.role ?? folder.id] ?? Inbox;
              return (
                <button
                  key={folder.id}
                  className={activeFolder === folder.id ? "folder-row active" : "folder-row"}
                  onClick={() => onFolderChange(folder.id)}
                  type="button"
                >
                  <Icon size={17} />
                  <span>{folder.label}</span>
                  <strong>{folder.count}</strong>
                </button>
              );
            })}
          </div>

            <div className="directory-section">
              <div className="section-label with-action">
                标签/项目
                <button
                  type="button"
                  aria-label="添加标签"
                  onClick={() => {
                    setLabelFormOpen((current) => !current);
                    setLabelNotice("");
                  }}
                >
                  +
                </button>
              </div>
              {labelFormOpen ? (
                <form
                  className="label-create-form"
                  aria-label="创建标签"
                  onSubmit={submitNewLabel}
                >
                  <input
                    aria-label="新标签名称"
                    placeholder="新标签"
                    value={newLabelName}
                    onChange={(event) => setNewLabelName(event.target.value)}
                  />
                  <button type="submit" disabled={labelBusy}>
                    创建
                  </button>
                </form>
              ) : null}
              {labelNotice ? (
                <div className="backend-notice compact" role="status">
                  {labelNotice}
                </div>
              ) : null}
              {labels.map((label) => (
              <button
                key={label.id}
                className={
                  activeFolder === `label:${label.id}`
                    ? "label-row active"
                    : "label-row"
                }
                type="button"
                onClick={() => onLabelChange(label.id)}
              >
                <span className={`label-dot ${label.tone}`} />
                <span>{label.label}</span>
                <strong>{label.count}</strong>
              </button>
            ))}
          </div>

          <div className="directory-section" aria-label="常用分类">
            <div className="section-label">常用分类</div>
            {quickCategories.map((category) => (
              <button
                key={category.id}
                className={
                  activeFolder === category.id
                    ? "label-row category-row active"
                    : "label-row category-row"
                }
                onClick={() => onSavedViewChange(category.id)}
                type="button"
              >
                <span className={`label-dot ${category.tone}`} />
                <span>{category.label}</span>
                <strong>{category.count}</strong>
              </button>
            ))}
          </div>
        </aside>
        <div
          className="pane-resize-handle mail-pane-resize-handle"
          aria-label="调整邮箱目录宽度"
          {...directorySeparatorProps}
        />

          <section className={`message-list-panel density-${density}`} aria-label="邮件列表">
            <div className="list-toolbar">
              <div>
                <h2>{folderTitle}</h2>
                <span>{folderCount} 封邮件</span>
              </div>
            <div className="list-toolbar-actions">
              <div className="density-control" aria-label="邮件列表密度">
                {densityOptions.map((option) => (
                  <button
                    key={option.id}
                    className={density === option.id ? "active" : ""}
                    type="button"
                    aria-label={option.label}
                    onClick={() => onDensityChange(option.id)}
                  >
                    <span aria-hidden="true">{option.shortLabel}</span>
                  </button>
                ))}
              </div>
            </div>
            </div>
            <div className="bulk-row">
              <label>
                <input
                  aria-label="选择当前列表全部邮件"
                  checked={allVisibleSelected}
                  type="checkbox"
                  onChange={(event) => toggleAllVisibleMail(event.currentTarget.checked)}
                />
                全部
              </label>
              <span className="selection-status" aria-live="polite">
                {selectedVisibleMail.length > 0
                  ? `已选 ${selectedVisibleMail.length} 封`
                  : `${mail.length} 封可见`}
              </span>
            </div>
            {mail.map((mail) => {
              const key = mailItemKey(mail);
              return (
                <div
                  key={key}
                  className={
                    activeMailId === key
                      ? "message-row active"
                      : "message-row"
                  }
                >
                  <input
                    aria-label={`Select message ${mail.subject}`}
                    checked={selectedMailKeys.has(key)}
                    type="checkbox"
                    onChange={(event) =>
                      toggleVisibleMail(mail, event.currentTarget.checked)
                    }
                  />
                  <span className={mail.unread ? "unread-dot" : "read-dot"} />
                  <button
                    className="message-row-open"
                    type="button"
                    onClick={() => onMailChange(key)}
                  >
                    <div className="message-row-main">
                      <div className="row-topline">
                        <strong>{mail.sender}</strong>
                        <time>{mail.time}</time>
                      </div>
                      <div className="row-subject">
                        <Star size={14} className={mail.starred ? "star-hot" : ""} />
                        <span>{mail.subject}</span>
                      </div>
                      <p>{mail.preview}</p>
                    </div>
                  </button>
                </div>
              );
            })}
          </section>
          <div
            className="pane-resize-handle mail-pane-resize-handle"
            aria-label="调整邮件列表宽度"
            {...messageListSeparatorProps}
          />
    </>
  );
}
