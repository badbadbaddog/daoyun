ALTER TABLE site_branding
    ADD COLUMN default_cover_url varchar(2048),
    ADD COLUMN navigation_links jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN footer_text varchar(200),
    ADD COLUMN footer_links jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT site_branding_navigation_links_array CHECK (
        jsonb_typeof(navigation_links) = 'array'
    ),
    ADD CONSTRAINT site_branding_footer_links_array CHECK (
        jsonb_typeof(footer_links) = 'array'
    ),
    ADD CONSTRAINT site_branding_footer_text_length CHECK (
        footer_text IS NULL OR char_length(footer_text) BETWEEN 1 AND 200
    );

CREATE TABLE site_branding_assets (
    kind varchar(16) PRIMARY KEY,
    storage_key varchar(512) NOT NULL UNIQUE,
    mime_type varchar(32) NOT NULL,
    sha256 bytea NOT NULL,
    size_bytes bigint NOT NULL,
    updated_by uuid NOT NULL REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT site_branding_asset_kind_valid CHECK (kind IN ('logo', 'favicon')),
    CONSTRAINT site_branding_asset_mime_valid CHECK (
        (kind = 'logo' AND mime_type IN ('image/png', 'image/webp'))
        OR (kind = 'favicon' AND mime_type = 'image/png')
    ),
    CONSTRAINT site_branding_asset_sha256_length CHECK (octet_length(sha256) = 32),
    CONSTRAINT site_branding_asset_size_valid CHECK (
        size_bytes BETWEEN 1 AND 2097152
        AND (kind <> 'favicon' OR size_bytes <= 524288)
    )
);
