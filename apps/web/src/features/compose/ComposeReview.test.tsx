import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComposeReview } from "./ComposeReview";

describe("ComposeReview", () => {
  it("renders controlled rich text, warnings, and attachment checks", () => {
    render(
      <ComposeReview
        preview={{
          accountId: "account_1",
          readyToSend: false,
          subject: "Launch plan",
          to: [{ address: "lina@example.com" }],
          cc: [],
          bcc: [],
          source: "manual",
          estimatedSizeBytes: 4096,
          warnings: ["missing_subject"],
          generatedAt: "2026-06-17T12:00:00.000Z",
        }}
        bodyText="> Please review"
        controlledBodyHtml="<blockquote><p>Please review</p></blockquote>"
        attachments={[
          {
            id: "attachment_1",
            source: "uploaded_file",
            attachmentId: "upload_1",
            filename: "launch.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
            inline: false,
          },
        ]}
        warningsText="缺少主题"
      />,
    );

    expect(screen.getByText("预览待处理")).toBeTruthy();
    expect(screen.getByText("1 收件人 · 4 KB")).toBeTruthy();
    expect(screen.getByText("缺少主题")).toBeTruthy();
    expect(screen.getByText("Launch plan")).toBeTruthy();

    const body = screen.getByLabelText("Compose review body");
    expect(body.querySelector("blockquote")?.textContent).toBe("Please review");

    const attachments = screen.getByLabelText("Compose review attachments");
    expect(within(attachments).getByText("附件 1")).toBeTruthy();
    expect(within(attachments).getByText("launch.pdf")).toBeTruthy();
    expect(within(attachments).getByText("2 KB")).toBeTruthy();
  });

  it("falls back to plain text and empty attachment state", () => {
    render(
      <ComposeReview
        preview={{
          accountId: "account_1",
          readyToSend: true,
          subject: "",
          to: [],
          cc: [],
          bcc: [],
          source: "manual",
          estimatedSizeBytes: 20,
          warnings: [],
          generatedAt: "2026-06-17T12:00:00.000Z",
        }}
        bodyText="Plain body"
        attachments={[]}
        warningsText=""
      />,
    );

    expect(screen.getByText("可发送预览")).toBeTruthy();
    expect(screen.getByText("无主题")).toBeTruthy();
    expect(screen.getByText("Plain body")).toBeTruthy();
    expect(screen.getByText("附件 0")).toBeTruthy();
    expect(screen.getByText("无附件")).toBeTruthy();
  });
});
