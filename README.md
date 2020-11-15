# Hugo Aide

This is a type-safe code generation for Hugo for when you need multiple variations of Hugo configuration files from a common source. 

## Usage

Create a TypeScript file like [hugo-config-experimental.ts](hugo-config-experimental.ts), known as a "Hugo Configurator *Module*":

```typescript
export const prime: hc.HugoConfigurationSupplier = {
  hugoConfigFileName: "experimental.toml",
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
```

A *Hugo Configurator Module* is then passed into `hactl.ts` like this:

```bash
source <(curl -Ls https://raw.githubusercontent.com/shah/hugo-aide/master/hactl-latest.env)
hactl inspect hc-supplier-names --module=file://`pwd`/hugo-config-experimental.ts
hactl configure experimental --module=file://`pwd`/hugo-config-experimental.ts --verbose
```

The `hactl configure` command runs the TypeScript module `hugo-config-experimental.ts` and passes in the identity `experimental` which calls  `configurator.configure('experimental')`, returns a `HugoConfiguration`, and saves it as the file name supplied in `hugoConfigFileName: "experimental.toml"`. 

Since the `hugoConfigFileName` was set to *experimental.toml* it's saved as a TOML file. If the name was *experimental.yaml* it would be stored as a YAML and if the name was *experimental.json* it would be stored as a JSON file. This allows you to store the Hugo Configuration in a type-safe TypeScript module and then generate whatever format is desired.

# CLI

```bash
source <(curl -Ls https://raw.githubusercontent.com/shah/hugo-aide/master/hactl-latest.env)
❯ hactl --help
Hugo Aide Controller v0.1.2.

Usage:
  hactl configure <hc-supplier-name> --module=<module.ts>... [--verbose]
  hactl inspect hc-supplier-names --module=<module.ts>...
  hactl -h | --help
  hactl --version

Options:
  -h --help             Show this screen
  <module.ts>           A Hugo Configurator TypeScript module
  <hc-supplier-name>    A Hugo Configuration supplier name
  --version             Show version
  --verbose             Be explicit about what's going on
```