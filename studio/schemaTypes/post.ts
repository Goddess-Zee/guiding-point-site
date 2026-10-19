import {defineType, defineField, defineArrayMember} from 'sanity'

export const post = defineType({
  name: 'post',
  title: 'Blog Post',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      type: 'string',
      validation: (r) => r.required().max(60).warning('Keep titles under 60 characters for SEO'),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      description: 'The URL. Must match the old filename for migrated posts.',
      options: {source: 'title', maxLength: 96},
      validation: (r) => r.required(),
    }),
    defineField({name: 'description', type: 'text', rows: 3, validation: (r) => r.required()}),
    defineField({name: 'pubDate', title: 'Publish date', type: 'date', validation: (r) => r.required()}),
    defineField({name: 'updatedDate', title: 'Updated date', type: 'date'}),
    defineField({name: 'author', type: 'string', initialValue: 'Zipporah Banyay'}),
    defineField({
      name: 'category',
      type: 'string',
      options: {
        list: [
          'Government Contracting',
          'Nonprofit Strategy',
          'Web Modernization',
          'AI & Content Strategy',
          'Subcontracting',
        ],
        layout: 'dropdown',
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'audience',
      type: 'array',
      of: [defineArrayMember({type: 'string'})],
      options: {
        list: [
          {title: 'Government primes', value: 'government-primes'},
          {title: 'Nonprofits', value: 'nonprofits'},
          {title: 'Both', value: 'both'},
        ],
        layout: 'grid',
      },
      initialValue: ['both'],
    }),
    defineField({
      name: 'tags',
      type: 'array',
      of: [defineArrayMember({type: 'string'})],
      options: {layout: 'tags'},
    }),
    defineField({name: 'featured', type: 'boolean', initialValue: false}),
    defineField({
      name: 'coverImage',
      title: 'Cover image',
      type: 'image',
      options: {hotspot: true},
      fields: [defineField({name: 'alt', title: 'Alt text', type: 'string'})],
    }),
    defineField({
      name: 'linkedin',
      title: 'LinkedIn',
      type: 'object',
      options: {collapsible: true, collapsed: false},
      fields: [
        defineField({name: 'hook', type: 'text', rows: 3}),
        defineField({name: 'cta', title: 'CTA', type: 'string'}),
        defineField({
          name: 'hashtags',
          type: 'array',
          of: [defineArrayMember({type: 'string'})],
          options: {layout: 'tags'},
        }),
      ],
    }),
    defineField({
      name: 'body',
      type: 'array',
      of: [
        defineArrayMember({type: 'block'}),
        defineArrayMember({
          type: 'image',
          fields: [defineField({name: 'alt', title: 'Alt text', type: 'string'})],
        }),
      ],
    }),
  ],
  orderings: [
    {title: 'Newest first', name: 'pubDateDesc', by: [{field: 'pubDate', direction: 'desc'}]},
  ],
  preview: {
    select: {title: 'title', subtitle: 'category', media: 'coverImage'},
  },
})