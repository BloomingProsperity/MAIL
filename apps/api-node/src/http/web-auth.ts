import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

import {
  type PoolLike,
  type Queryable,
  withTransaction,
} from "../db/transaction.js";

const PASSWORD_HASH_VERSION = "scrypt-v1";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

export type WebAuthRole = "owner" | "admin";

export interface WebAuthUser {
  id: string;
  email: string;
  role: WebAuthRole;
  passwordHash: string;
  createdAt: string;
}

export interface CreateFirstWebAuthAdminInput {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface WebAuthStore {
  countAdmins(): Promise<number>;
  createFirstAdmin(input: CreateFirstWebAuthAdminInput): Promise<WebAuthUser>;
  findUserByEmail(email: string): Promise<WebAuthUser | undefined>;
}

export class WebAuthAdminAlreadyExistsError extends Error {
  constructor() {
    super("web_auth_admin_already_exists");
    this.name = "WebAuthAdminAlreadyExistsError";
  }
}

export class InvalidWebAuthCredentialsError extends Error {
  constructor(message = "invalid_web_auth_credentials") {
    super(message);
    this.name = "InvalidWebAuthCredentialsError";
  }
}

interface WebAuthUserRow extends Record<string, unknown> {
  id: string;
  email: string;
  role: WebAuthRole;
  password_hash: string;
  created_at: string | Date;
}

interface CountRow extends Record<string, unknown> {
  count: string | number;
}

export function createPostgresWebAuthStore(client: PoolLike): WebAuthStore {
  return {
    async countAdmins() {
      return countAdmins(client);
    },

    async createFirstAdmin(input) {
      return withTransaction(client, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "emailhub:web-auth:first-admin",
        ]);
        const existingAdminCount = await countAdmins(tx);
        if (existingAdminCount > 0) {
          throw new WebAuthAdminAlreadyExistsError();
        }

        const result = await tx.query<WebAuthUserRow>(
          `
            INSERT INTO web_auth_users (
              id,
              email,
              email_normalized,
              password_hash,
              role,
              created_at
            )
            VALUES ($1, $2, $3, $4, 'owner', $5)
            RETURNING id, email, role, password_hash, created_at
          `,
          [
            input.id,
            input.email,
            normalizeWebAuthEmail(input.email),
            input.passwordHash,
            input.createdAt,
          ],
        );

        return rowToUser(result.rows[0]);
      });
    },

    async findUserByEmail(email) {
      const result = await client.query<WebAuthUserRow>(
        `
          SELECT id, email, role, password_hash, created_at
          FROM web_auth_users
          WHERE email_normalized = $1
          LIMIT 1
        `,
        [normalizeWebAuthEmail(email)],
      );

      return result.rows[0] ? rowToUser(result.rows[0]) : undefined;
    },
  };
}

export function createInMemoryWebAuthStore(): WebAuthStore {
  const users: WebAuthUser[] = [];

  return {
    async countAdmins() {
      return users.length;
    },

    async createFirstAdmin(input) {
      if (users.length > 0) {
        throw new WebAuthAdminAlreadyExistsError();
      }

      const user: WebAuthUser = {
        id: input.id,
        email: input.email,
        role: "owner",
        passwordHash: input.passwordHash,
        createdAt: input.createdAt,
      };
      users.push(user);
      return user;
    },

    async findUserByEmail(email) {
      const normalized = normalizeWebAuthEmail(email);
      return users.find((user) => normalizeWebAuthEmail(user.email) === normalized);
    },
  };
}

export function normalizeWebAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateWebAuthEmail(email: string): string {
  const normalized = normalizeWebAuthEmail(email);
  if (!/^[a-z0-9._@+-]{3,254}$/.test(normalized)) {
    throw new InvalidWebAuthCredentialsError("invalid_email");
  }

  return normalized;
}

export function validateWebAuthPassword(password: string): string {
  if (password.length < 4) {
    throw new InvalidWebAuthCredentialsError("weak_password");
  }

  return password;
}

export async function hashWebAuthPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await deriveScryptKey(
    password,
    salt,
    PASSWORD_KEY_LENGTH,
    PASSWORD_SCRYPT_OPTIONS,
  );

  return [
    PASSWORD_HASH_VERSION,
    PASSWORD_SCRYPT_OPTIONS.N,
    PASSWORD_SCRYPT_OPTIONS.r,
    PASSWORD_SCRYPT_OPTIONS.p,
    salt,
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyWebAuthPassword(input: {
  password: string;
  passwordHash: string;
}): Promise<boolean> {
  const parts = input.passwordHash.split("$");
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_VERSION) {
    return false;
  }

  const [, nRaw, rRaw, pRaw, salt, expectedRaw] = parts;
  const expected = Buffer.from(expectedRaw, "base64url");
  const actual = await deriveScryptKey(input.password, salt, expected.length, {
    N: Number.parseInt(nRaw, 10),
    r: Number.parseInt(rRaw, 10),
    p: Number.parseInt(pRaw, 10),
    maxmem: PASSWORD_SCRYPT_OPTIONS.maxmem,
  });

  return (
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}

function deriveScryptKey(
  password: string,
  salt: string,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

async function countAdmins(client: Queryable): Promise<number> {
  const result = await client.query<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM web_auth_users
      WHERE role IN ('owner', 'admin')
    `,
  );

  return Number(result.rows[0]?.count ?? 0);
}

function rowToUser(row: WebAuthUserRow): WebAuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    passwordHash: row.password_hash,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}
