# Santana Site — refactoring baseline

This repository preserves the theme currently used by the Santana Fitness WordPress
site as a small, reviewable starting point for a future rebuild/refactor.

## Included

- `site/themes/fitnesszone-2.6/`: the active-looking legacy theme, **Fitness Zone
  2.6** by DesignThemes.

## Intentionally excluded

The local source came from a WordPress backup dated 2026-08-28. It also contains a
database dump, duplicated extracted backup directories, plugin bundles, theme ZIPs
and approximately 1.2 GB of WordPress uploads. These are not committed because they
may contain personal data, credentials, licensed third-party code, and media assets,
and are unsuitable for ordinary Git history.

The original local backup is retained under `site/` and is ignored by Git except for
the theme listed above.

## Legacy WordPress dependencies observed

The backup contains the following plugin directories. Treat this as an inventory to
validate against the live installation, not as a deployment manifest:

`akismet`, `all-in-one-wp-migration`, `bbpress`, `buddypress`,
`designthemes-core-features`, `envato-wordpress-toolkit`,
`gallery-and-caption`, `hello-dolly`, `js_composer`, `mailchimp-for-wp`, `revslider`,
`roses-like-this`, `s2member`, `timetable`, `unyson`, `updraftplus`, `wordpress-seo`,
`wpglobus-for-wpbakery-visual-composer`, and `wpme-google-maps`.

## Next steps before a rebuild

1. Confirm the active WordPress theme and plugins from the production admin.
2. Export only the content and media that are approved for migration.
3. Replace the legacy theme and page-builder/plugin coupling with a maintained stack.
4. Rotate any production credentials that may have existed in the original backup.
