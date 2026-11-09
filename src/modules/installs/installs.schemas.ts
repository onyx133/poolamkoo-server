import { z } from 'zod';

export const STORES = ['bazaar', 'myket', 'play', 'direct'] as const;
export type Store = (typeof STORES)[number];

export const registerInstallBody = z.strictObject({
  install_id: z.uuidv4(),
  platform: z.literal('android'),
  // semver-ish: 0.1.0, 1.2.3-beta.1, 1.2.3+45
  app_version: z
    .string()
    .max(32)
    .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/, 'must look like 1.2.3'),
  store: z.enum(STORES),
});
export type RegisterInstallBody = z.infer<typeof registerInstallBody>;

export const registerInstallResponse = z.object({
  access_token: z.string(),
  expires_at: z.string(),
});
