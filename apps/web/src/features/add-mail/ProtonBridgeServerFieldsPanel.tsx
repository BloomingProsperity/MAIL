import type { ProtonBridgeServerFields } from "./protonBridgeOnboarding";

export function ProtonBridgeServerFieldsPanel(props: {
  fields: ProtonBridgeServerFields;
  onFieldChange: <K extends keyof ProtonBridgeServerFields>(
    key: K,
    value: ProtonBridgeServerFields[K],
  ) => void;
}) {
  return (
    <div className="custom-server-grid bridge-server-grid">
      <label>
        <span>Bridge 收信地址</span>
        <input
          aria-label="Proton Bridge receive host"
          value={props.fields.receiveHost}
          placeholder="127.0.0.1"
          onChange={(event) =>
            props.onFieldChange("receiveHost", event.currentTarget.value)
          }
        />
      </label>
      <label>
        <span>Bridge 收信端口</span>
        <input
          aria-label="Proton Bridge receive port"
          value={props.fields.receivePort}
          inputMode="numeric"
          onChange={(event) =>
            props.onFieldChange("receivePort", event.currentTarget.value)
          }
        />
      </label>
      <label>
        <span>Bridge 发信地址</span>
        <input
          aria-label="Proton Bridge send host"
          value={props.fields.sendHost}
          placeholder="127.0.0.1"
          onChange={(event) =>
            props.onFieldChange("sendHost", event.currentTarget.value)
          }
        />
      </label>
      <label>
        <span>Bridge 发信端口</span>
        <input
          aria-label="Proton Bridge send port"
          value={props.fields.sendPort}
          inputMode="numeric"
          onChange={(event) =>
            props.onFieldChange("sendPort", event.currentTarget.value)
          }
        />
      </label>
      <label className="server-toggle">
        <input
          aria-label="Proton Bridge receive secure"
          checked={props.fields.receiveSecure}
          type="checkbox"
          onChange={(event) =>
            props.onFieldChange("receiveSecure", event.currentTarget.checked)
          }
        />
        <span>收信使用加密连接</span>
      </label>
      <label className="server-toggle">
        <input
          aria-label="Proton Bridge send secure"
          checked={props.fields.sendSecure}
          type="checkbox"
          onChange={(event) =>
            props.onFieldChange("sendSecure", event.currentTarget.checked)
          }
        />
        <span>发信使用加密连接</span>
      </label>
    </div>
  );
}
