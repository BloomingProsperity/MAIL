import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
const panelStyles = readFileSync(
  join(process.cwd(), "src", "styles-panels.css"),
  "utf8",
);

function ruleBody(selector: string): string {
  return ruleBodyFrom(styles, selector);
}

function panelRuleBody(selector: string): string {
  return ruleBodyFrom(panelStyles, selector);
}

function ruleBodyFrom(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  return match?.[1] ?? "";
}

describe("mail density styles", () => {
  it("keeps the base UI readable for a desktop mail client", () => {
    expect(ruleBody("body")).toContain("font-size: 15px");
  });

  it("keeps Outlook-style density modes materially different", () => {
    expect(ruleBody(".density-compact .message-row")).toContain("min-height: 48px");
    expect(ruleBody(".density-comfortable .message-row")).toContain("min-height: 62px");
    expect(ruleBody(".density-roomy .message-row")).toContain("min-height: 82px");
  });

  it("keeps search readable and common controls dense for mail workflows", () => {
    expect(ruleBody(".top-search,\n.large-search")).toContain("min-height: 38px");
    expect(ruleBody(".primary-button,\n.ghost-button,\n.tiny-button,\n.tiny-icon-button,\n.icon-button,\n.toolbar-button,\n.provider-card button,\n.task-row button,\n.filter-row button,\n.dock-launcher,\n.dock-model,\n.dock-action,\n.dock-send")).toContain("min-height: 30px");
  });

  it("lets the Hermes dock expand into a useful bottom panel", () => {
    expect(panelRuleBody(".hermes-dock.is-open")).toContain(
      "height: min(760px, max(520px, 68vh), calc(100vh - 48px))",
    );
    expect(panelRuleBody(".hermes-dock.is-open")).toContain(
      "grid-template-rows: auto minmax(0, 1fr)",
    );
    expect(panelRuleBody(".dock-body")).toContain(
      "overflow: hidden auto",
    );
    expect(panelRuleBody(".dock-empty")).toContain("min-height: 100%");
  });

  it("lets the mailbox columns fill the available desktop viewport", () => {
    expect(ruleBody(".main-area")).toContain("padding: 14px 16px 16px");
    expect(ruleBody(".mail-grid")).toContain("height: 100%");
    expect(ruleBody(".mail-grid")).toContain("min-height: 0");
    expect(ruleBody(".mail-grid")).toContain("flex: 1 1 0");
    expect(ruleBody(".mail-grid")).toContain(
      "minmax(420px, var(--message-list-width, 460px))",
    );
  });

  it("keeps the message list readable without Smart Inbox bulk controls", () => {
    expect(ruleBody(".selection-status")).toContain("white-space: nowrap");
    expect(styles).toContain(".row-subject span,\n.message-row p");
    expect(styles).toContain("text-overflow: ellipsis");
    expect(styles).not.toContain(".smart-inbox-actions");
    expect(styles).not.toContain(".smart-inbox-action-set");
  });

  it("prevents mobile reader content from widening the page", () => {
    expect(ruleBody(".reader-content")).toContain("min-width: 0");
    expect(ruleBody(".reader-heading")).toContain("min-width: 0");
    expect(ruleBody(".reader-heading h2")).toContain("overflow-wrap: anywhere");
    expect(ruleBody(".message-body")).toContain("min-width: 0");
    expect(ruleBody(".message-body")).toContain("overflow-wrap: anywhere");
    expect(ruleBody(".composer-top span")).toContain("overflow-wrap: anywhere");
  });
});
