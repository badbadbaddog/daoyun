DROP TABLE IF EXISTS site_branding_assets;

ALTER TABLE site_branding
    DROP CONSTRAINT IF EXISTS site_branding_footer_text_length,
    DROP CONSTRAINT IF EXISTS site_branding_footer_links_array,
    DROP CONSTRAINT IF EXISTS site_branding_navigation_links_array,
    DROP COLUMN IF EXISTS footer_links,
    DROP COLUMN IF EXISTS footer_text,
    DROP COLUMN IF EXISTS navigation_links,
    DROP COLUMN IF EXISTS default_cover_url;
