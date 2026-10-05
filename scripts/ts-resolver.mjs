/**
 * Module resolution hook for the CLI scripts.
 *
 * The application uses bundler-style extensionless imports (`../types`), which
 * Next.js resolves. Node's type-stripping loader does not, so the scripts
 * register this hook to try the TypeScript extensions and index files before
 * giving up.
 */
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[a-z0-9]+$/i.test(specifier);

  if (isRelative) {
    const normalized = specifier === "." ? "./" : specifier === ".." ? "../" : specifier;
    const base = normalized.endsWith("/") ? normalized : `${normalized}/`;
    const candidates = hasExtension
      ? [specifier]
      : [`${specifier}.ts`, `${specifier}.tsx`, `${base}index.ts`, `${base}index.tsx`];
    for (const candidate of candidates) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        /* try the next candidate */
      }
    }
  }
  return nextResolve(specifier, context);
}
