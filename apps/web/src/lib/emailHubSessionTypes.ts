export interface EmailHubSessionDto {
  authenticated: boolean;
  authDisabled?: boolean;
  setupRequired?: boolean;
  accountIds?: string[];
  expiresAt?: string;
  user?: {
    email: string;
    role: "owner" | "admin";
  };
}

export interface EmailHubLoginInput {
  email: string;
  password: string;
}

export interface EmailHubSetupAdminInput {
  email: string;
  password: string;
}

export interface EmailHubSessionApi {
  getSession(): Promise<EmailHubSessionDto>;
  createAdmin(input: EmailHubSetupAdminInput): Promise<EmailHubSessionDto>;
  login(input: EmailHubLoginInput): Promise<EmailHubSessionDto>;
  logout(): Promise<EmailHubSessionDto>;
}
