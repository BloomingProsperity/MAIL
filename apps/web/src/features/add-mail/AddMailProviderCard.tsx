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
  const idleLabel = providerActionLabel(provider);
  const disabled = Boolean(props.busy || props.disabled);

  function handleConnect() {
    if (!disabled) {
      props.onConnect();
    }
  }

  return (
    <article
      aria-label={`${provider.title} 接入卡片`}
      className={`provider-card${disabled ? " is-disabled" : ""}`}
      onClick={handleConnect}
    >
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
      </div>
      <button
        type="button"
        aria-label={`连接 ${provider.title}`}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          handleConnect();
        }}
      >
        {props.busy ? "连接中" : idleLabel}
      </button>
    </article>
  );
}

function providerActionLabel(provider: AddMailProviderOption) {
  if (provider.action === "oauth") {
    return "网页登录";
  }
  if (provider.action === "manual") {
    return "手动设置";
  }
  if (provider.action === "bridge") {
    return "填写 Bridge";
  }
  if (
    provider.badges.includes("专用密码") &&
    !provider.badges.includes("授权码")
  ) {
    return "填写专用密码";
  }
  if (provider.badges.includes("专用密码")) {
    return "填写授权信息";
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
