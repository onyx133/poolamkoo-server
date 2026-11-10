import type { Config } from './config.js';
import type { PrismaClient } from './lib/prisma.js';
import { PrismaCatalogRepository } from './modules/catalog/catalog.repository.js';
import { CatalogService } from './modules/catalog/catalog.service.js';
import { HealthService } from './modules/health/health.service.js';
import { PrismaInstallsRepository } from './modules/installs/installs.repository.js';
import { InstallsService } from './modules/installs/installs.service.js';
import { PrismaRulePacksRepository } from './modules/rule-packs/rule-packs.repository.js';
import { RulePacksService } from './modules/rule-packs/rule-packs.service.js';

// Wiring by construction: repositories -> services. Nothing here is global.
export interface Container {
  health: HealthService;
  installs: InstallsService;
  catalog: CatalogService;
  rulePacks: RulePacksService;
  // WIRE-HERE (1/2): add the services of new modules to this interface, e.g.
  //   profile: ProfileService; offers: OffersService;
}

export interface ContainerOptions {
  /** Test hook: clock (epoch ms) for time-based caches. */
  now?: () => number;
}

export function createContainer(
  config: Config,
  prisma: PrismaClient,
  options: ContainerOptions = {},
): Container {
  const installs = new InstallsService({
    repo: new PrismaInstallsRepository(prisma),
    pepper: config.serverPepper,
  });

  return {
    health: new HealthService(config.appVersion),
    installs,
    catalog: new CatalogService({
      repo: new PrismaCatalogRepository(prisma),
      ...(options.now ? { now: options.now } : {}),
    }),
    rulePacks: new RulePacksService(new PrismaRulePacksRepository(prisma)),
    // WIRE-HERE (2/2): construct new modules' repository + service and return them here.
  };
}
