# Marketing Website

`dbackup-website`, the public site at dbackup.app. Next.js 16 App Router with `output: "export"` and `trailingSlash: true`, so it builds to a static bundle in `out/` and ships to Cloudflare. A workspace of its own with its own `pnpm-lock.yaml`.

```bash
pnpm dev     # local dev server
pnpm build   # static export to out/
pnpm type    # tsc --noEmit
pnpm lint    # eslint
```

## Layout

```
src/app/(en)/              English routes at the root: /, /blog, /blog/[slug], /blog/rss.xml, /roadmap, /integrations, /integrations/[slug], and the social cards og.png
src/app/(de)/de/           The same routes in German under /de/
src/app/                   robots.ts, sitemap.ts, global-not-found.tsx and globals.css, shared by both languages
src/components/pages/      One component per page, with its metadata, taking the locale. The route files only wrap them
src/i18n/                  config.ts, translate.ts, provider.tsx and messages/en.json, de.json
src/components/site/       Header, menu, footer, home sections, blog and roadmap parts
src/content/blog/          Posts as <slug>.mdx, translations as <slug>.de.mdx
src/lib/                   blog, content, integrations, highlight, roadmap, seo, site, utils
```

## Languages

English lives at `/`, German under `/de/`, with no middleware since the export is static. Each language is a route group with its own root layout, both rendering `RootShell`, so `<html lang>` is right in the HTML. A new page gets a component in `components/pages/` and a route file in both groups. A new language gets its route group, its message file and its entry in `LOCALES`.

- **Copy goes through the messages**, never into the JSX. `src/i18n/messages/en.json` is the source and the type of every key, `de.json` mirrors it key by key and falls back to English for a missing one. The files are i18next JSON, nested keys with `_one` and `_other` for plurals and `{name}` placeholders, so Weblate reads them as they are. `t.rich()` turns tags like `<shine>`, `<link>`, `<code>` and `<br>` into elements. German addresses the reader with "Sie" and writes ß.
- A group of keys and a text never share a name: `roadmap.shipped` is the group of shipped entries, the heading is `roadmap.shippedTitle`.
- Server components call `createTranslator(locale)` and take `locale` as a prop, client components call `useI18n()`, which also gives `path()`. Every internal link goes through `localePath` or `path`.
- `LANGUAGE_SCRIPT` runs in the head before the first paint. Auto follows the first language of the browser the site has, a language picked in the switcher wins and is kept in localStorage as `dbackup-lang`, and crawlers stay on the page they asked for. It is plain ES5 inside a template string, so a regex needs its backslashes doubled.
- Terminal output, log lines, commands, file names and the names of products and adapters stay as they are in every language. The words of the app in the demos are keys. An adapter whose name is a word, like Local Filesystem, carries a `labelKey`.
- The roadmap keeps only structure in `src/lib/roadmap.ts`. Its text lives under `roadmap.items.<slug>`, `roadmap.shipped.<slug>` and `roadmap.milestones.<slug>`, and a slug without messages does not compile.

## Blog

A post is `src/content/blog/<slug>.mdx` with `title`, `date`, `excerpt`, `tags`, `author` and a `cover` with a `tone`. The author is a GitHub username, its avatar shows beside the post. A translation sits beside it as `<slug>.de.mdx` with only `title`, `excerpt` and optionally `tags`. Without a translation the German page shows the English text with a notice, marks it `lang="en"` and points its canonical at the English page.

A post can list the databases it talks about under `databases`, by the slugs of their pages. They are linked in a card at the end of the post, in every language.

A post page takes the color of its `tone` through `data-post-tone` and the `--post-*` variables in `globals.css`, Tailwind knows it as the color `post`. An illustration sits in `public/blog/<slug>.webp` (2400 by 1260) with its social card `public/blog/<slug>.jpg` (1200 by 630). They are drawn in the color of the post on the Blog page of the DBackup Illustrations canvas, with almost no text, so one picture serves every language.

## Integrations

`/integrations/` lists every adapter of `src/lib/content.ts` with a search, and `/integrations/<slug>/` is the page of one database, for the slugs in `DATABASE_SLUGS` of `src/lib/integrations.ts`. That file holds what reads the same in every language: the demo run, the archive, the commands of the Recovery Kit, the compose service and the login snippet. The text of a page lives under `integrations.db.<slug>`, a card under `integrations.cards.<adapter>` and the line under a storage or notification adapter under `integrations.kinds.<adapter>`, and a slug or adapter without its keys does not compile. Snippets are highlighted by `highlight()` during the export, so no highlighter ships to the browser.

Every fact on these pages comes from the code of the adapter, never from the docs alone, which lag behind in places. A version range the code does not check is written as the range the docs support, next to the versions the integration tests run against. A new page gets its slug, its data, its messages in both languages and its slug in `databases` of the posts that talk about it. The footer, the sitemap and the answer on the supported databases on the home page pick it up from `DATABASE_SLUGS`, the answer through a tag named after the slug.

## SEO

`pageMetadata()` in `src/lib/seo.ts` sets the title, the description, the canonical, the hreflang alternates and the social cards of a page, and every page builds its metadata with it. The cards are route handlers at `og.png` and `blog/[slug]/og.png`, since a `.png` path makes the host send them as images. The sitemap lists every language a page exists in, with x-default, trailing slashes and a lastmod only where a real date exists. The 404 page is `app/global-not-found.tsx`, served through `not_found_handling` in `wrangler.jsonc`.

Changelog scope for anything in this directory is `**website**`.
