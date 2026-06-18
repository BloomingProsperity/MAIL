import { AtSign } from "lucide-react";
import type { AddMailProviderOption } from "./providerCapabilities";
import "./AddMailProviderCard.css";

const providerIconSources: Record<string, string> = {
  gmail: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico",
  outlook: "https://res.cdn.office.net/assets/mail/pwa/v1/pngs/apple-touch-icon.png",
  "163": "https://mail.163.com/favicon.ico",
  qq: "https://mail.qq.com/favicon.ico",
  icloud: "https://www.icloud.com/favicon.ico",
  proton: "https://mail.proton.me/assets/apple-touch-icon.png",
  proton_bridge: "https://mail.proton.me/assets/apple-touch-icon.png",
  tencent_exmail: "https://exmail.qq.com/favicon.ico",
};

export function AddMailProviderCard(props: {
  provider: AddMailProviderOption;
  busy?: boolean;
  disabled?: boolean;
  onConnect: () => void;
}) {
  const provider = props.provider;
  const idleLabel = providerActionLabel(provider.action);
  return (
    <article className="provider-card">
      <ProviderIcon
        mark={provider.mark}
        provider={provider.provider}
        title={provider.title}
      />
      <div>
        <strong>{provider.title}</strong>
        <span>{provider.subtitle}</span>
        {provider.badges.length > 0 ? (
          <div
            className="provider-card-badges"
            aria-label={`${provider.title} 接入方式`}
          >
            {provider.badges.map((badge) => (
              <span key={badge}>{badge}</span>
            ))}
          </div>
        ) : null}
        {provider.setupHints.length > 0 ? (
          <ul
            className="provider-card-hints"
            aria-label={`${provider.title} 准备事项`}
          >
            {provider.setupHints.slice(0, 3).map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`连接 ${provider.title}`}
        disabled={props.busy || props.disabled}
        onClick={props.onConnect}
      >
        {props.busy ? "连接中" : idleLabel}
      </button>
    </article>
  );
}

function providerActionLabel(action: AddMailProviderOption["action"]) {
  if (action === "oauth") {
    return "网页登录";
  }
  if (action === "manual") {
    return "手动设置";
  }
  if (action === "bridge") {
    return "填写 Bridge";
  }

  return "填写授权码";
}

function ProviderIcon(props: { provider: string; title: string; mark: string }) {
  const source = providerIconSources[props.provider];

  if (source) {
    return (
      <div className="provider-icon official-icon" aria-label={`${props.title} 图标`}>
        <img src={source} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </div>
    );
  }

  if (props.provider === "custom" || props.provider === "custom_domain") {
    return (
      <div className="provider-icon custom-icon" aria-label={`${props.title} 图标`}>
        <AtSign size={22} />
      </div>
    );
  }

  return (
    <div className={`provider-icon ${props.provider}-icon`} aria-label={`${props.title} 图标`}>
      <span>{props.mark}</span>
    </div>
  );
}
