import * as ctl from "./controller.ts";
import * as hugo from "./hugo-config.ts";

export type PublicationModuleIdentity = string;

export interface PublicationModule {
  readonly identity: PublicationModuleIdentity;
}

export type PublicationIdentity = string;

export interface Publication {
  readonly identity: PublicationIdentity;
  readonly hugoModuleName: string;
  readonly isDefault: boolean;
  readonly configuration: (
    ctx: ctl.PublicationsController,
  ) => hugo.HugoConfigurationSupplier;
}

export interface PublicationsSupplier {
  readonly publications: Record<string, Publication>;
}

export interface PublicationModulesSupplier {
  readonly publModules: PublicationModule[];
}
