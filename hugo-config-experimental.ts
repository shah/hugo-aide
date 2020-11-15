import * as hc from "./hugo-config.ts";

export const prime: hc.HugoConfigurationSupplier = {
  hugConfigFileName: "experimental.toml",
  hugoConfig: {
    baseURL: "//experimental.site",
    title: "Experimental Configuration",
    theme: "experimental",
    ...hc.typicalHugoConfig,
  },
};

export const configurator: hc.HugoConfigurator = {
  name: "experimental",
  identities: (): hc.HugoConfigurationIdentity[] => {
    return ["experimental"];
  },
  configure: (
    name: hc.HugoConfigurationIdentity,
  ): hc.HugoConfigurationSupplier | undefined => {
    switch (name) {
      case "experimental":
        return prime;
    }
    return undefined;
  },
};

// required for hactl.ts
export default configurator;
