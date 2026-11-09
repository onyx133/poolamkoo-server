import { z } from 'zod';

export const offersResponse = z.object({
  offers: z.array(
    z.object({
      id: z.string(),
      title_fa: z.string(),
      body_fa: z.string(),
      cta_fa: z.string(),
      url: z.string(),
      expires_at: z.string(),
    }),
  ),
});
export type OffersResponse = z.infer<typeof offersResponse>;
