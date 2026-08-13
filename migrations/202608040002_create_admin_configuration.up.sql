CREATE TABLE site_branding (
    id smallint PRIMARY KEY DEFAULT 1,
    site_name varchar(80) NOT NULL DEFAULT '刀云',
    logo_url varchar(2048),
    favicon_url varchar(2048),
    primary_color varchar(7) NOT NULL DEFAULT '#0f766e',
    accent_color varchar(7) NOT NULL DEFAULT '#2563eb',
    theme_preset varchar(24) NOT NULL DEFAULT 'default',
    list_density varchar(16) NOT NULL DEFAULT 'comfortable',
    home_mode varchar(16) NOT NULL DEFAULT 'latest',
    updated_by uuid REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT site_branding_singleton CHECK (id = 1),
    CONSTRAINT site_branding_name_length CHECK (char_length(site_name) BETWEEN 1 AND 80),
    CONSTRAINT site_branding_primary_color_format CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT site_branding_accent_color_format CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT site_branding_theme_preset_valid CHECK (
        theme_preset IN ('default', 'dark', 'compact', 'high_contrast')
    ),
    CONSTRAINT site_branding_list_density_valid CHECK (
        list_density IN ('comfortable', 'compact')
    ),
    CONSTRAINT site_branding_home_mode_valid CHECK (
        home_mode IN ('latest', 'hot', 'featured')
    )
);

INSERT INTO site_branding (id) VALUES (1);

CREATE TABLE admin_audit_log (
    id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES users (id),
    action varchar(64) NOT NULL,
    resource_type varchar(32) NOT NULL,
    resource_id uuid,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT admin_audit_action_length CHECK (char_length(action) BETWEEN 1 AND 64),
    CONSTRAINT admin_audit_resource_type_length CHECK (char_length(resource_type) BETWEEN 1 AND 32)
);

CREATE INDEX admin_audit_actor_time_index
    ON admin_audit_log (actor_id, created_at DESC, id DESC);

CREATE INDEX admin_audit_resource_time_index
    ON admin_audit_log (resource_type, resource_id, created_at DESC, id DESC);
