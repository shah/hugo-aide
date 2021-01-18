import { shcGitHub as gh, shcGitLab as gl } from "./deps.ts";

export type Identity = string;

export interface Identifiable {
  readonly identity: Identity;
}

// deno-lint-ignore no-empty-interface
export interface UnionableAssetsProvenance extends Identifiable {
}

export interface UnionableAssetsGitRepo extends UnionableAssetsProvenance {
  readonly repo: gh.GitLabRepo | gl.GitHubRepo;
}

// deno-lint-ignore no-empty-interface
export interface UnionableAssets extends Identifiable {
}

export type PublicationModuleIdentity = string;

// deno-lint-ignore no-empty-interface
export interface PublicationModule extends Identifiable {
}

export type PublicationIdentity = string;

// deno-lint-ignore no-empty-interface
export interface Publication extends Identifiable {
}

export interface PublicationsSupplier {
  readonly publications: Record<string, Publication>;
}

export interface PublicationModulesSupplier {
  readonly publModules: PublicationModule[];
}
