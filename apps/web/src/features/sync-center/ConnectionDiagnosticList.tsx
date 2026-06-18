import type { ImapSmtpConnectionDiagnostic } from "../../lib/emailHubApi";
import {
  formatConnectionDiagnosticAction,
  formatConnectionDiagnosticProviderLabel,
  formatConnectionDiagnosticScope,
  formatConnectionDiagnosticTitle,
} from "./connectionDiagnostics";

export function ConnectionDiagnosticList(props: {
  diagnostics: ImapSmtpConnectionDiagnostic[];
  ariaLabel: string;
  title?: string;
  className?: string;
  rowClassName?: string;
  role?: "status";
  container?: "div" | "section";
}) {
  if (props.diagnostics.length === 0) {
    return null;
  }

  const Container = props.container ?? "section";
  return (
    <Container
      className={props.className ?? "diagnostic-list"}
      role={props.role}
      aria-label={props.ariaLabel}
    >
      {props.title ? <h2>{props.title}</h2> : null}
      {props.diagnostics.map((diagnostic) => (
        <div
          className={props.rowClassName ?? "diagnostic-row"}
          key={`${diagnostic.provider}:${diagnostic.affected}:${diagnostic.code}`}
        >
          <div>
            <strong>{formatConnectionDiagnosticTitle(diagnostic)}</strong>
            <span>
              {formatConnectionDiagnosticProviderLabel(diagnostic.provider)} ·{" "}
              {formatConnectionDiagnosticScope(diagnostic)}
            </span>
            <p>{formatConnectionDiagnosticAction(diagnostic)}</p>
          </div>
        </div>
      ))}
    </Container>
  );
}
