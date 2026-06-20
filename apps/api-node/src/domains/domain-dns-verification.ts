import { resolveMx, resolveTxt } from "node:dns/promises";

import type { DomainDnsRecords } from "./domain-alias.js";

export interface DomainDnsResolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveMx(name: string): Promise<Array<{ exchange: string; priority: number }>>;
}

const defaultResolver: DomainDnsResolver = { resolveTxt, resolveMx };

export async function verifyDomainDnsRecords(
  dnsRecords: DomainDnsRecords,
  resolver: DomainDnsResolver = defaultResolver,
): Promise<boolean> {
  const [ownershipTxtVerified, mxVerified] = await Promise.all([
    verifyTxtRecord(
      resolver,
      dnsRecords.ownershipTxt.name,
      dnsRecords.ownershipTxt.value,
    ),
    verifyMxRecord(resolver, dnsRecords.mx.name, dnsRecords.mx.value),
  ]);
  return ownershipTxtVerified && mxVerified;
}

async function verifyTxtRecord(
  resolver: DomainDnsResolver,
  name: string,
  expectedValue: string,
): Promise<boolean> {
  try {
    const records = await resolver.resolveTxt(name);
    return records.some((chunks) => chunks.join("") === expectedValue);
  } catch {
    return false;
  }
}

async function verifyMxRecord(
  resolver: DomainDnsResolver,
  name: string,
  expectedValue: string,
): Promise<boolean> {
  try {
    const expectedExchange = normalizeDnsName(expectedMxExchange(expectedValue));
    const records = await resolver.resolveMx(name);
    return records.some(
      (record) => normalizeDnsName(record.exchange) === expectedExchange,
    );
  } catch {
    return false;
  }
}

function expectedMxExchange(value: string): string {
  const parts = value.trim().split(/\s+/);
  return parts.length > 1 && /^\d+$/.test(parts[0]) ? parts[1] : parts[0];
}

function normalizeDnsName(value: string): string {
  return value.trim().replace(/\.$/, "").toLowerCase();
}
