import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { resolveEnterpriseBridgeConfig } from "./src/config.js";
import { createEnterpriseBridgeHandler } from "./src/http.js";

export default definePluginEntry({
  id: "enterprise-bridge",
  name: "Enterprise Bridge",
  description:
    "Normalizes channel ingress into enterprise control-plane envelopes for managed tenant runtimes.",
  async register(api: OpenClawPluginApi) {
    const bridgeConfig = await resolveEnterpriseBridgeConfig({
      pluginConfig: api.pluginConfig,
      cfg: api.config,
      env: process.env,
      logger: api.logger,
    });
    if (bridgeConfig.bindings.length === 0) {
      return;
    }

    const bindingsByPath = new Map(
      bridgeConfig.bindings.map((binding) => [binding.path, binding]),
    );
    const handler = createEnterpriseBridgeHandler({
      cfg: bridgeConfig,
      bindingsByPath,
    });

    for (const binding of bridgeConfig.bindings) {
      api.registerHttpRoute({
        path: binding.path,
        auth: "plugin",
        match: "exact",
        replaceExisting: true,
        handler,
      });
      api.logger.info?.(
        `[enterprise-bridge] registered ${binding.channel} binding ${binding.bindingId} on ${binding.path}`,
      );
    }
  },
});
