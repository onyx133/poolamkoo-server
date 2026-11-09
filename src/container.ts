import type { Config } from './config.js';
import type { PrismaClient } from './lib/prisma.js';
import { HealthService } from './modules/health/health.service.js';
import { PrismaOffersRepository } from './modules/offers/offers.repository.js';
import { OffersService } from './modules/offers/offers.service.js';
import { PrismaProfileRepository } from './modules/profile/profile.repository.js';
import { ProfileService } from './modules/profile/profile.service.js';
import { PrismaInstallsRepository } from './modules/installs/installs.repository.js';
import { InstallsService } from './modules/installs/installs.service.js';

// Wiring by construction: repositories -> services. Nothing here is global.
export interface Container {
  health: HealthService;
  installs: InstallsService;
  profile: ProfileService;
  offers: OffersService;
  // WIRE-HERE (1/2): add the services of new modules to this interface, e.g.
  //   profile: ProfileService; offers: OffersService; catalog: CatalogService; rulePacks: RulePacksService;
}

export function createContainer(config: Config, prisma: PrismaClient): Container {
  const installs = new InstallsService({
    repo: new PrismaInstallsRepository(prisma),
    pepper: config.serverPepper,
  });

  return {
    health: new HealthService(config.appVersion),
    installs,
    profile: new ProfileService(new PrismaProfileRepository(prisma)),
    offers: new OffersService({ repo: new PrismaOffersRepository(prisma) }),
    // WIRE-HERE (2/2): construct new modules' repository + service and return them here.
  };
}
