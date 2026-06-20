import type { AddMailProviderGroupId } from "./AddMailAndSyncPages";

const addMailProviderGroupProviders: Record<AddMailProviderGroupId, string[]> = {
  gmail: ["gmail"],
  outlook: ["outlook"],
  icloud: ["icloud"],
  domestic: ["163", "qq", "tencent_exmail"],
  proton: ["proton", "proton_bridge"],
  domain: ["custom", "custom_domain"],
};

export function isProviderInAddMailProviderGroup(
  provider: string,
  groupId: AddMailProviderGroupId | undefined,
): boolean {
  if (!groupId) {
    return true;
  }
  return addMailProviderGroupProviders[groupId].includes(
    provider.trim().toLowerCase(),
  );
}

export function accountIdentityKey(email: string, provider: string): string {
  return `${provider.trim().toLowerCase()}:${email.trim().toLowerCase()}`;
}
