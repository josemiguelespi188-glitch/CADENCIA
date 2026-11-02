/** Shared slug/initials helpers for turning a free-text name into an
 * athletes row's `slug`/`initials` columns — used by both the admin
 * invite flow and Google self-registration, so a new athlete always
 * gets the same shape regardless of how their account was created. */
export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "athlete"
  );
}

export function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return chars.join("") || "??";
}

/** Dedupes a candidate slug against a set of slugs already in use,
 * appending "-2", "-3", etc. until it's unique. */
export function dedupeSlug(candidate: string, existingSlugs: Set<string>) {
  let slug = candidate;
  let i = 2;
  while (existingSlugs.has(slug)) {
    slug = `${candidate}-${i++}`;
  }
  return slug;
}
