import {
  extend as ex,
  govnSvcMetrics as gsm,
  safety,
  shcGitHub as gh,
  shcGitLab as gl,
} from "./deps.ts";

export type Identity = string;
export type CronSpec = string;

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
export interface PublicationModuleOptions {
}

export interface PublicationModuleOptionsSupplier<
  O extends PublicationModuleOptions,
> {
  readonly publModuleOptions: O;
}

export function isPublicationModuleOptionsSupplier<
  O extends PublicationModuleOptions,
>(o: unknown): o is PublicationModuleOptionsSupplier<O> {
  const isPMOS = safety.typeGuard<PublicationModuleOptionsSupplier<O>>(
    "publModuleOptions",
  );
  return isPMOS(o);
}

// deno-lint-ignore no-empty-interface
export interface PublicationModule extends Identifiable {
}

// deno-lint-ignore no-empty-interface
export interface PublicationModuleContentOrchestratorInspectContext {
}

export interface PublicationModuleContentOrchestrator extends Identifiable {
  readonly openMetrics: (
    ctx: PublicationModuleContentOrchestratorInspectContext,
  ) => [storedIn: string, collected: gsm.Metric[]];
  readonly inspect: (
    ctx: PublicationModuleContentOrchestratorInspectContext,
  ) => string[];
}

// deno-lint-ignore no-empty-interface
export interface PublicationModuleContentProducerContext {
}

export interface PublicationModuleContentProducer<T extends ex.PluginExecutive>
  extends PublicationModuleContentOrchestrator {
  readonly schedule: (ctx: PublicationModuleContentProducerContext) => CronSpec;
  readonly produce: (
    ctx: ex.PluginContext<T>,
  ) => Promise<void | ex.ActionResult<T>>;
}

// deno-lint-ignore no-empty-interface
export interface Publication extends Identifiable {
}

export interface PublicationsSupplier {
  readonly publications: Record<Identity, Publication>;
}

export interface PublicationModulesSupplier {
  readonly publModules: PublicationModule[];
}
