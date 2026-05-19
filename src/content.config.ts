import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Goddess Zee'),
    category: z.enum([
      'Government Contracting',
      'Nonprofit Strategy',
      'Web Modernization',
      'AI & Content Strategy',
      'Subcontracting',
    ]),
    audience: z.array(
      z.enum(['government-primes', 'nonprofits', 'both'])
    ).default(['both']),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    coverImage: z.string().optional(),
    coverAlt: z.string().optional(),
    linkedin: z.object({
      hook: z.string(),
      cta: z.string(),
      hashtags: z.array(z.string()).default([]),
    }).optional(),
  }),
});

export const collections = { blog };