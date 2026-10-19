// src/lib/sanity.ts
// Fetches blog posts from Sanity and reshapes them to match the old
// Astro content-collection shape (post.slug + post.data.*), so the page
// templates barely change.

import { createClient } from '@sanity/client';
import { createImageUrlBuilder } from '@sanity/image-url';

export const sanity = createClient({
  projectId: 'f1mbayb1',
  dataset: 'production',
  apiVersion: '2026-10-01',
  useCdn: false, // always fetch fresh content at build time
});

const builder = createImageUrlBuilder(sanity);
export const urlFor = (source: any) => builder.image(source).auto('format');

export interface Post {
  slug: string;
  body?: any[];
  data: {
    title: string;
    description: string;
    pubDate: Date;
    updatedDate?: Date;
    author: string;
    category: string;
    audience: string[];
    tags: string[];
    featured: boolean;
    coverImage?: string;
    coverAlt?: string;
    linkedin?: { hook: string; cta: string; hashtags: string[] };
  };
}

// Sanity stores dates as "2026-09-15". Noon avoids the date shifting a day by timezone.
const toDate = (value?: string) => (value ? new Date(`${value}T12:00:00`) : undefined);

// Only published posts come back: drafts are never visible without an API token.
export async function getAllPosts({ withBody = false } = {}): Promise<Post[]> {
  const query = `*[_type == "post" && defined(slug.current)] | order(pubDate desc) {
    title, "slug": slug.current, description, pubDate, updatedDate, author,
    category, audience, tags, featured, coverImage, linkedin
    ${withBody ? ', body' : ''}
  }`;

  const docs: any[] = await sanity.fetch(query);

  return docs.map((d) => ({
    slug: d.slug,
    body: d.body,
    data: {
      title: d.title,
      description: d.description ?? '',
      pubDate: toDate(d.pubDate)!,
      updatedDate: toDate(d.updatedDate),
      author: d.author ?? 'Zipporah Banyay',
      category: d.category,
      audience: d.audience ?? ['both'],
      tags: d.tags ?? [],
      featured: Boolean(d.featured),
      coverImage: d.coverImage?.asset ? urlFor(d.coverImage).width(1200).url() : undefined,
      coverAlt: d.coverImage?.alt,
      linkedin: d.linkedin
        ? {
            hook: d.linkedin.hook ?? '',
            cta: d.linkedin.cta ?? '',
            hashtags: d.linkedin.hashtags ?? [],
          }
        : undefined,
    },
  }));
}