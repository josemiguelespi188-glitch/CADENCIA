import type { Locale } from "@/lib/i18n/context";
import type { Template } from "@/lib/types";

/**
 * `templates.title`/`notes` are free text, athlete-entered, so they can't
 * flow through the app's `t(key)` dictionary the way UI chrome does.
 * `title_en`/`notes_en` are optional companion columns an admin can fill
 * in — when the viewer's locale is English and one is set, show it;
 * otherwise fall back to the original (Spanish) text rather than a blank
 * field. Found live (Nov 2026): the seeded Base workouts presets were all
 * Spanish regardless of the platform's own EN/ES toggle, which read as
 * inconsistent once the app itself switched to English.
 */
export function templateTitle(tpl: Template, locale: Locale): string {
  return locale === "en" && tpl.title_en ? tpl.title_en : tpl.title;
}

export function templateNotes(tpl: Template, locale: Locale): string {
  return locale === "en" && tpl.notes_en ? tpl.notes_en : tpl.notes;
}
