import { z } from "zod";
import type { PluginLogger } from "../api.js";
import {
  normalizeWebhookPath,
  resolveConfiguredSecretInputString,
  type OpenClawConfig,
} from "../runtime-api.js";

const secretRefSchema = z
  .object({
    source: z.enum(["env", "file", "exec"]),
    provider: z.string().trim().min(1),
    id: z.string().trim().min(1),
  })
  .strict();

const secretInputSchema = z.union([z.string().trim().min(1), secretRefSchema]);

const bindingSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    path: z.string().trim().min(1).optional(),
    sessionKey: z.string().trim().min(1),
    tenantId: z.string().trim().min(1),
    channel: z.enum(["dashboard", "webchat", "whatsapp", "email"]),
    secret: secretInputSchema,
    actorUserId: z.string().trim().min(1).optional(),
    roleId: z.string().trim().min(1).optional(),
    department: z.string().trim().min(1).optional(),
  })
  .strict();

const pluginConfigSchema = z
  .object({
    controlPlane: z
      .object({
        baseUrl: z.string().trim().min(1),
        apiKey: secretInputSchema.optional(),
        envelopePath: z.string().trim().min(1).default("/v1/channels/envelopes"),
      })
      .strict(),
    bindings: z.record(z.string().trim().min(1), bindingSchema).default({}),
  })
  .strict();

export type ResolvedEnterpriseBinding = {
  bindingId: string;
  path: string;
  sessionKey: string;
  tenantId: string;
  channel: "dashboard" | "webchat" | "whatsapp" | "email";
  secret: string;
  actorUserId?: string;
  roleId?: string;
  department?: string;
};

export type ResolvedEnterpriseBridgeConfig = {
  baseUrl: string;
  envelopePath: string;
  apiKey?: string;
  bindings: ResolvedEnterpriseBinding[];
};

export async function resolveEnterpriseBridgeConfig(params: {
  pluginConfig: unknown;
  cfg: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  logger?: PluginLogger;
}): Promise<ResolvedEnterpriseBridgeConfig> {
  const parsed = pluginConfigSchema.parse(params.pluginConfig ?? {});
  let apiKey: string | undefined;

  if (parsed.controlPlane.apiKey) {
    const resolution = await resolveConfiguredSecretInputString({
      config: params.cfg,
      env: params.env,
      value: parsed.controlPlane.apiKey,
      path: "plugins.entries.enterprise-bridge.controlPlane.apiKey",
    });
    apiKey = resolution.value?.trim() || undefined;
  }

  const bindings: ResolvedEnterpriseBinding[] = [];
  for (const [bindingId, binding] of Object.entries(parsed.bindings)) {
    if (!binding.enabled) {
      continue;
    }
    const secretResolution = await resolveConfiguredSecretInputString({
      config: params.cfg,
      env: params.env,
      value: binding.secret,
      path: `plugins.entries.enterprise-bridge.bindings.${bindingId}.secret`,
    });
    const secret = secretResolution.value?.trim();
    if (!secret) {
      params.logger?.warn?.(
        `[enterprise-bridge] skipping binding ${bindingId}: ${
          secretResolution.unresolvedRefReason ?? "secret is empty or unresolved"
        }`,
      );
      continue;
    }
    bindings.push({
      bindingId,
      path: normalizeWebhookPath(binding.path ?? `/plugins/enterprise-bridge/${bindingId}`),
      sessionKey: binding.sessionKey,
      tenantId: binding.tenantId,
      channel: binding.channel,
      secret,
      ...(binding.actorUserId ? { actorUserId: binding.actorUserId } : {}),
      ...(binding.roleId ? { roleId: binding.roleId } : {}),
      ...(binding.department ? { department: binding.department } : {}),
    });
  }

  return {
    baseUrl: parsed.controlPlane.baseUrl.replace(/\/+$/, ""),
    envelopePath: parsed.controlPlane.envelopePath,
    ...(apiKey ? { apiKey } : {}),
    bindings,
  };
}
