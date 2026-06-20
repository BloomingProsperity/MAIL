import { useEffect, useState } from "react";
import type {
  DomainAliasDto,
  DomainCatchAllMode,
  DomainCatchAllRuleDto,
  DomainDeliveryLogDto,
  DomainDestinationDto,
  DomainDto,
  EmailHubApi,
} from "../../lib/emailHubApi";

export function DomainAliasSettingsPanel(props: {
  api?: EmailHubApi;
  mode: "aliases" | "domains";
}) {
  const [domains, setDomains] = useState<DomainDto[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [destinations, setDestinations] = useState<DomainDestinationDto[]>([]);
  const [aliases, setAliases] = useState<DomainAliasDto[]>([]);
  const [logs, setLogs] = useState<DomainDeliveryLogDto[]>([]);
  const [notice, setNotice] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [cloudflareApiToken, setCloudflareApiToken] = useState("");
  const [cloudflareZoneId, setCloudflareZoneId] = useState("");
  const [destinationEmail, setDestinationEmail] = useState("");
  const [aliasLocalPart, setAliasLocalPart] = useState("");
  const [aliasDestinationId, setAliasDestinationId] = useState("");
  const [catchAllMode, setCatchAllMode] =
    useState<DomainCatchAllMode>("reject");
  const [catchAllDestinationId, setCatchAllDestinationId] = useState("");
  const [lastCatchAll, setLastCatchAll] =
    useState<DomainCatchAllRuleDto | undefined>();
  const [busyAction, setBusyAction] = useState("");

  useEffect(() => {
    if (!props.api) {
      const previewDomainId = "preview_domain";
      const previewDestinationId = "preview_destination";
      setDomains([
        {
          id: previewDomainId,
          domain: "example.com",
          verificationStatus: "pending",
          dnsRecords: {
            ownershipTxt: {
              type: "TXT",
              name: "_emailhub.example.com",
              value: "emailhub-domain-verification=preview_domain",
            },
            mx: {
              type: "MX",
              name: "example.com",
              value: "10 mx.emailhub.local",
            },
          },
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ]);
      setSelectedDomainId(previewDomainId);
      setDestinations([
        {
          id: previewDestinationId,
          domainId: previewDomainId,
          email: "owner@example.net",
          verified: false,
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ]);
      setAliases([
        {
          id: "preview_alias",
          domainId: previewDomainId,
          address: "support@example.com",
          localPart: "support",
          enabled: true,
          destinationIds: [previewDestinationId],
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ]);
      setLogs([
        {
          id: "preview_log",
          domainId: previewDomainId,
          recipient: "support@example.com",
          status: "delivered",
          createdAt: "2026-06-13T09:00:00.000Z",
        },
      ]);
      setAliasDestinationId(previewDestinationId);
      setCatchAllDestinationId(previewDestinationId);
      setLastCatchAll(undefined);
      setNotice("");
      return;
    }

    let alive = true;
    setNotice("");
    void props.api
      .listDomains()
      .then((domainPage) => {
        if (!alive) {
          return undefined;
        }
        setDomains(domainPage.items);
        const nextDomainId =
          domainPage.items.find((domain) => domain.id === selectedDomainId)
            ?.id ??
          domainPage.items[0]?.id ??
          "";
        setSelectedDomainId(nextDomainId);
        if (!nextDomainId) {
          setDestinations([]);
          setAliases([]);
          setLogs([]);
          setNotice("还没有添加个人域名。");
          return undefined;
        }
        return loadDomainDetail(nextDomainId, () => alive);
      })
      .catch(() => {
        if (!alive) return;
        setDomains([]);
        setSelectedDomainId("");
        setDestinations([]);
        setAliases([]);
        setLogs([]);
        setNotice("域名设置暂时不可用。");
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  async function loadDomainDetail(domainId: string, isAlive = () => true) {
    if (!props.api || !domainId) {
      return;
    }

    try {
      const [destinationPage, aliasPage, catchAllResponse, logPage] =
        await Promise.all([
          props.api.listDomainDestinations({ domainId }),
          props.api.listDomainAliases({ domainId }),
          props.api.getDomainCatchAll({ domainId }),
          props.api.listDomainDeliveryLogs({
            domainId,
            limit: 20,
          }),
        ]);
      if (!isAlive()) {
        return;
      }
      setDestinations(destinationPage.items);
      setAliases(aliasPage.items);
      setLogs(logPage.items);
      setLastCatchAll(catchAllResponse.item ?? undefined);
      setCatchAllMode(catchAllResponse.item?.config.mode ?? "reject");
      const preferredCatchAllDestinationId =
        catchAllResponse.item?.config.destinationIds?.[0] ??
        destinationPage.items[0]?.id ??
        "";
      setAliasDestinationId(destinationPage.items[0]?.id ?? "");
      setCatchAllDestinationId(preferredCatchAllDestinationId);
      setNotice("");
    } catch {
      if (!isAlive()) {
        return;
      }
      setDestinations([]);
      setAliases([]);
      setLogs([]);
      setNotice("域名详情暂时不可用。");
    }
  }

  async function refreshDomains(preferredDomainId?: string) {
    if (!props.api) {
      return;
    }
    const domainPage = await props.api.listDomains();
    setDomains(domainPage.items);
    const nextDomainId =
      preferredDomainId ??
      domainPage.items.find((domain) => domain.id === selectedDomainId)?.id ??
      domainPage.items[0]?.id ??
      "";
    setSelectedDomainId(nextDomainId);
    if (!nextDomainId) {
      setDestinations([]);
      setAliases([]);
      setLogs([]);
      setNotice("还没有添加个人域名。");
      return;
    }
    await loadDomainDetail(nextDomainId);
  }

  async function createDomain() {
    if (!props.api) {
      setNotice("域名暂时无法添加。");
      return;
    }
    const domain = domainInput.trim();
    if (!domain) {
      setNotice("请先填写域名。");
      return;
    }

    setBusyAction("domain");
    try {
      const created = await props.api.createDomain({ domain });
      setDomainInput("");
      setNotice(`${created.domain} 已加入域名管理，等待 DNS 验证。`);
      await refreshDomains(created.id);
    } catch {
      setNotice("域名添加失败，请检查域名格式或是否已存在。");
    } finally {
      setBusyAction("");
    }
  }

  async function verifySelectedDomain() {
    if (!props.api) {
      setNotice("域名验证暂时不可用。");
      return;
    }
    if (!selectedDomainId) {
      setNotice("请先选择域名。");
      return;
    }

    setBusyAction("verify-domain");
    try {
      const verifiedDomain = await props.api.verifyDomain({
        domainId: selectedDomainId,
      });
      setDomains((current) =>
        current.map((domain) =>
          domain.id === verifiedDomain.id ? verifiedDomain : domain,
        ),
      );
      setNotice(
        verifiedDomain.verificationStatus === "verified"
          ? `${verifiedDomain.domain} DNS 验证通过。`
          : "DNS 尚未验证通过，请检查 TXT 与 MX 记录。",
      );
    } catch {
      setNotice("DNS 验证失败，请稍后重试。");
    } finally {
      setBusyAction("");
    }
  }

  async function configureCloudflareDns() {
    if (!props.api) {
      setNotice("Cloudflare 自动配置暂时不可用。");
      return;
    }
    if (!selectedDomainId) {
      setNotice("请先选择域名。");
      return;
    }
    const apiToken = cloudflareApiToken.trim();
    if (!apiToken) {
      setNotice("请先填写 Cloudflare API Token。");
      return;
    }

    setBusyAction("cloudflare");
    try {
      const result = await props.api.configureDomainCloudflare({
        domainId: selectedDomainId,
        apiToken,
        zoneId: cloudflareZoneId.trim() || undefined,
      });
      const createdCount = result.records.filter(
        (record) => record.status === "created",
      ).length;
      const existingCount = result.records.length - createdCount;
      setNotice(
        `Cloudflare 已处理 ${result.records.length} 条 DNS 记录（新增 ${createdCount}，已存在 ${existingCount}），请等待生效后验证 DNS。`,
      );
    } catch {
      setNotice("Cloudflare 自动配置失败，请检查 Token 权限或改用手动记录。");
    } finally {
      setCloudflareApiToken("");
      setBusyAction("");
    }
  }

  async function createDestination() {
    if (!props.api) {
      setNotice("目标邮箱暂时无法添加。");
      return;
    }
    if (!selectedDomainId) {
      setNotice("请先选择域名。");
      return;
    }
    const email = destinationEmail.trim();
    if (!email) {
      setNotice("请先填写目标邮箱。");
      return;
    }

    setBusyAction("destination");
    try {
      const destination = await props.api.createDomainDestination({
        domainId: selectedDomainId,
        email,
      });
      setDestinationEmail("");
      setAliasDestinationId(destination.id);
      setCatchAllDestinationId(destination.id);
      setNotice(`${destination.email} 已加入转发目标，等待确认。`);
      await loadDomainDetail(selectedDomainId);
    } catch {
      setNotice("目标邮箱添加失败，请检查邮箱格式。");
    } finally {
      setBusyAction("");
    }
  }

  async function createAlias() {
    if (!props.api) {
      setNotice("别名暂时无法添加。");
      return;
    }
    if (!selectedDomainId) {
      setNotice("请先选择域名。");
      return;
    }
    const localPart = aliasLocalPart.trim();
    if (!localPart) {
      setNotice("请先填写别名前缀。");
      return;
    }
    if (!aliasDestinationId) {
      setNotice("请先添加并选择一个转发目标。");
      return;
    }

    setBusyAction("alias");
    try {
      const alias = await props.api.createDomainAlias({
        domainId: selectedDomainId,
        localPart,
        destinationIds: [aliasDestinationId],
      });
      setAliasLocalPart("");
      setNotice(`${alias.address} 已创建并启用。`);
      await loadDomainDetail(selectedDomainId);
    } catch {
      setNotice("别名创建失败，请检查前缀和转发目标。");
    } finally {
      setBusyAction("");
    }
  }

  async function setCatchAll() {
    if (!props.api) {
      setNotice("默认收件地址暂时无法设置。");
      return;
    }
    if (!selectedDomainId) {
      setNotice("请先选择域名。");
      return;
    }
    if (catchAllMode === "forward" && !catchAllDestinationId) {
      setNotice("转发 catch-all 需要先选择目标邮箱。");
      return;
    }

    setBusyAction("catch-all");
    try {
      const rule = await props.api.setDomainCatchAll({
        domainId: selectedDomainId,
        mode: catchAllMode,
        ...(catchAllMode === "forward"
          ? { destinationIds: [catchAllDestinationId] }
          : {}),
      });
      setLastCatchAll(rule);
      setNotice(`Catch-all 已设置为${formatCatchAllMode(rule.config.mode)}。`);
    } catch {
      setNotice("Catch-all 设置失败，请检查目标邮箱和模式。");
    } finally {
      setBusyAction("");
    }
  }

  async function selectDomain(domainId: string) {
    setSelectedDomainId(domainId);
    setLastCatchAll(undefined);
    setCloudflareApiToken("");
    setCloudflareZoneId("");
    setNotice("");
    await loadDomainDetail(domainId);
  }

  const title = props.mode === "domains" ? "域名管理" : "别名转发";
  const selectedDomain = domains.find((domain) => domain.id === selectedDomainId);
  const dnsRecords = selectedDomain
    ? domainDnsRecordRows(selectedDomain.dnsRecords)
    : [];

  return (
    <section className="settings-panel">
      <header className="settings-panel-head">
        <div>
          <h2>{title}</h2>
        </div>
      </header>
      {notice ? (
        <div className="backend-notice" role="status">
          {notice}
        </div>
      ) : null}
      <div className="settings-card-grid domain-setup-grid">
        <article className="settings-module domain-command">
          <div>
            <h3>添加个人域名</h3>
          </div>
          <label>
            <span>域名</span>
            <input
              aria-label="Domain name"
              value={domainInput}
              placeholder="example.com"
              onChange={(event) => setDomainInput(event.currentTarget.value)}
            />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={busyAction === "domain"}
            onClick={() => void createDomain()}
          >
            添加域名
          </button>
        </article>
        <article className="settings-module domain-command domain-current-card">
          <div className="domain-current-summary">
            <div>
              <h3>当前域名</h3>
              <p>
                {selectedDomain
                  ? `${selectedDomain.domain} · ${formatDomainStatus(
                      selectedDomain.verificationStatus,
                    )}`
                  : "还没有域名。"}
              </p>
            </div>
            <label>
              <span>选择域名</span>
              <select
                aria-label="Domain selector"
                value={selectedDomainId}
                disabled={domains.length === 0}
                onChange={(event) => void selectDomain(event.currentTarget.value)}
              >
                {domains.length === 0 ? <option value="">无域名</option> : null}
                {domains.map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.domain} · {formatDomainStatus(domain.verificationStatus)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="ghost-button"
              type="button"
              disabled={busyAction === "verify-domain" || !selectedDomainId}
              onClick={() => void verifySelectedDomain()}
            >
              验证 DNS
            </button>
          </div>
          <div className="domain-dns-column">
            <div className="dns-record-list" aria-label="Domain DNS records">
              {dnsRecords.length > 0 ? (
                dnsRecords.map((record) => (
                  <p key={`${record.label}-${record.name}-${record.value}`}>
                    <strong>{record.label}</strong>
                    <span>
                      {record.type} · {record.name}
                    </span>
                    <code>{record.value}</code>
                  </p>
                ))
              ) : (
                <p>暂无 DNS 记录。</p>
              )}
            </div>
            <div className="cloudflare-dns-form">
              <label>
                <span>Cloudflare API Token</span>
                <input
                  aria-label="Cloudflare API token"
                  autoComplete="off"
                  type="password"
                  value={cloudflareApiToken}
                  placeholder="Zone DNS Edit token"
                  onChange={(event) =>
                    setCloudflareApiToken(event.currentTarget.value)
                  }
                />
              </label>
              <label>
                <span>Zone ID（可选）</span>
                <input
                  aria-label="Cloudflare zone id"
                  value={cloudflareZoneId}
                  placeholder="留空自动查找"
                  onChange={(event) =>
                    setCloudflareZoneId(event.currentTarget.value)
                  }
                />
              </label>
              <button
                className="ghost-button"
                type="button"
                disabled={busyAction === "cloudflare" || !selectedDomainId}
                onClick={() => void configureCloudflareDns()}
              >
                Cloudflare 自动配置
              </button>
              <p className="domain-help-text">
                Token 仅本次使用，需要 Zone DNS Read 与 DNS Edit 权限。
              </p>
            </div>
          </div>
        </article>
      </div>
      <div className="settings-card-grid">
        <article className="settings-module domain-command">
          <div>
            <h3>目标邮箱</h3>
          </div>
          <label>
            <span>邮箱地址</span>
            <input
              aria-label="Domain destination email"
              value={destinationEmail}
              placeholder="owner@example.net"
              onChange={(event) =>
                setDestinationEmail(event.currentTarget.value)
              }
            />
          </label>
          <button
            className="ghost-button"
            type="button"
            disabled={busyAction === "destination" || !selectedDomainId}
            onClick={() => void createDestination()}
          >
            添加目标邮箱
          </button>
          <div className="domain-item-list">
            {destinations.length > 0 ? (
              destinations.map((destination) => (
                <p key={destination.id}>
                  <strong>{destination.email}</strong>
                  <span>{destination.verified ? "已确认" : "待确认"}</span>
                </p>
              ))
            ) : (
              <p>还没有目标邮箱。</p>
            )}
          </div>
        </article>
        <article className="settings-module domain-command">
          <div>
            <h3>别名地址</h3>
          </div>
          <div className="alias-form-grid">
            <label>
              <span>别名前缀</span>
              <input
                aria-label="Domain alias local part"
                value={aliasLocalPart}
                placeholder="support"
                onChange={(event) =>
                  setAliasLocalPart(event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>转发目标</span>
              <select
                aria-label="Domain alias destination"
                value={aliasDestinationId}
                disabled={destinations.length === 0}
                onChange={(event) =>
                  setAliasDestinationId(event.currentTarget.value)
                }
              >
                {destinations.length === 0 ? (
                  <option value="">无目标邮箱</option>
                ) : null}
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.email}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={busyAction === "alias" || !selectedDomainId}
            onClick={() => void createAlias()}
          >
            创建别名
          </button>
          <div className="domain-item-list">
            {aliases.length > 0 ? (
              aliases.map((alias) => (
                <p key={alias.id}>
                  <strong>{alias.address}</strong>
                  <span>{alias.enabled ? "启用中" : "已停用"}</span>
                </p>
              ))
            ) : (
              <p>还没有别名。</p>
            )}
          </div>
        </article>
      </div>
      <div className="settings-card-grid">
        <article className="settings-module domain-command">
          <div>
            <h3>Catch-all</h3>
            <p>
              {lastCatchAll
                ? `最近设置：${formatCatchAllMode(lastCatchAll.config.mode)}`
                : "未在本次会话中变更。"}
            </p>
          </div>
          <div className="alias-form-grid">
            <label>
              <span>模式</span>
              <select
                aria-label="Domain catch-all mode"
                value={catchAllMode}
                onChange={(event) =>
                  setCatchAllMode(event.currentTarget.value as DomainCatchAllMode)
                }
              >
                <option value="reject">拒收未知地址</option>
                <option value="forward">转发到目标邮箱</option>
                <option value="auto_create">自动创建别名</option>
                <option value="discard">静默丢弃</option>
              </select>
            </label>
            <label>
              <span>目标邮箱</span>
              <select
                aria-label="Domain catch-all destination"
                value={catchAllDestinationId}
                disabled={destinations.length === 0 || catchAllMode !== "forward"}
                onChange={(event) =>
                  setCatchAllDestinationId(event.currentTarget.value)
                }
              >
                {destinations.length === 0 ? (
                  <option value="">无目标邮箱</option>
                ) : null}
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.email}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="ghost-button"
            type="button"
            disabled={busyAction === "catch-all" || !selectedDomainId}
            onClick={() => void setCatchAll()}
          >
            保存 Catch-all
          </button>
        </article>
        <article className="settings-module">
          <div>
            <h3>最近投递</h3>
            {logs.length > 0 ? (
              logs.map((log) => (
                <p key={log.id}>
                  <strong>{log.recipient}</strong> ·{" "}
                  {formatDeliveryStatus(log.status)}
                </p>
              ))
            ) : (
              <p>还没有投递记录。</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

function domainDnsRecordRows(value: unknown): Array<{
  label: string;
  type: string;
  name: string;
  value: string;
}> {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([key, record]) => {
      if (!record || typeof record !== "object") {
        return undefined;
      }
      const candidate = record as Record<string, unknown>;
      if (
        typeof candidate.type !== "string" ||
        typeof candidate.name !== "string" ||
        typeof candidate.value !== "string"
      ) {
        return undefined;
      }
      return {
        label: formatDnsRecordLabel(key),
        type: candidate.type,
        name: candidate.name,
        value: candidate.value,
      };
    })
    .filter((record): record is {
      label: string;
      type: string;
      name: string;
      value: string;
    } => record !== undefined);
}

function formatDnsRecordLabel(value: string): string {
  if (value === "ownershipTxt") return "所有权";
  if (value === "mx") return "MX";
  if (value === "spf") return "SPF";
  if (value === "dmarc") return "DMARC";
  return value;
}

function formatCatchAllMode(value: DomainCatchAllMode): string {
  if (value === "forward") return "转发";
  if (value === "auto_create") return "自动创建别名";
  if (value === "discard") return "静默丢弃";
  return "拒收";
}

function formatDomainStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "待确认",
    verified: "已确认",
    failed: "需处理",
  };
  return labels[status] ?? status;
}

function formatDeliveryStatus(status: string) {
  const labels: Record<string, string> = {
    accepted: "已接收",
    matched: "已匹配",
    queued: "排队中",
    delivered: "已送达",
    deferred: "稍后重试",
    bounced: "退回",
    dropped: "已丢弃",
  };
  return labels[status] ?? status;
}
