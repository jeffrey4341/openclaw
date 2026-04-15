import type { IncomingMessage, ServerResponse } from "node:http";
import { safeEqualSecret } from "openclaw/plugin-sdk/browser-security-runtime";
import { readJsonWebhookBodyOrReject } from "../runtime-api.js";
import type { ResolvedEnterpriseBinding, ResolvedEnterpriseBridgeConfig } from "./config.js";

type JsonRecord = Record<string, unknown>;

function sendJson(response: ServerResponse, statusCode: number, payload: JsonRecord): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function createEnterpriseBridgeHandler(params: {
  cfg: ResolvedEnterpriseBridgeConfig;
  bindingsByPath: Map<string, ResolvedEnterpriseBinding>;
}) {
  return async function enterpriseBridgeHandler(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const pathname = request.url?.split("?")[0] ?? "";
    const binding = params.bindingsByPath.get(pathname);
    if (!binding) {
      sendJson(response, 404, { error: "binding_not_found" });
      return;
    }

    const providedSecret = String(request.headers["x-enterprise-bridge-secret"] ?? "");
    if (!providedSecret || !safeEqualSecret(providedSecret, binding.secret)) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    const body = await readJsonWebhookBodyOrReject(request, response);
    if (!body || typeof body !== "object") {
      return;
    }

    const envelope = {
      envelopeId: String((body as JsonRecord).envelopeId ?? `env_${Date.now()}`),
      tenantId: binding.tenantId,
      channel: binding.channel,
      sessionKey: String((body as JsonRecord).sessionKey ?? binding.sessionKey),
      messageId: String((body as JsonRecord).messageId ?? `msg_${Date.now()}`),
      actorUserId: String((body as JsonRecord).actorUserId ?? binding.actorUserId ?? "unknown_user"),
      roleId: String((body as JsonRecord).roleId ?? binding.roleId ?? "employee_user"),
      department: (body as JsonRecord).department ?? binding.department ?? null,
      content: String((body as JsonRecord).content ?? ""),
      receivedAt: String((body as JsonRecord).receivedAt ?? new Date().toISOString()),
      metadata: {
        openclawBindingId: binding.bindingId,
        openclawSessionKey: binding.sessionKey,
        ...(typeof (body as JsonRecord).metadata === "object" &&
        (body as JsonRecord).metadata !== null
          ? ((body as JsonRecord).metadata as JsonRecord)
          : {}),
      },
    };

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (params.cfg.apiKey) {
      headers["x-api-key"] = params.cfg.apiKey;
    }

    const upstream = await fetch(`${params.cfg.baseUrl}${params.cfg.envelopePath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
    });
    const text = await upstream.text();

    response.statusCode = upstream.status;
    response.setHeader(
      "content-type",
      upstream.headers.get("content-type") || "application/json; charset=utf-8",
    );
    response.end(text);
  };
}
