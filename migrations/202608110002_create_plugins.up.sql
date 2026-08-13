CREATE TABLE plugins (
    id uuid PRIMARY KEY,
    key varchar(64) NOT NULL UNIQUE,
    name varchar(80) NOT NULL,
    version varchar(32) NOT NULL,
    description varchar(500) NOT NULL DEFAULT '',
    capabilities jsonb NOT NULL,
    component_bytes bytea NOT NULL,
    component_sha256 char(64) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'disabled',
    revision bigint NOT NULL DEFAULT 1,
    installed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT plugins_key_valid CHECK (key ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT plugins_name_valid CHECK (
        char_length(name) BETWEEN 1 AND 80
        AND name = btrim(name)
    ),
    CONSTRAINT plugins_version_valid CHECK (
        version ~ '^(0|[1-9][0-9]{0,9})\.(0|[1-9][0-9]{0,9})\.(0|[1-9][0-9]{0,9})$'
    ),
    CONSTRAINT plugins_description_valid CHECK (char_length(description) <= 500),
    CONSTRAINT plugins_capabilities_valid CHECK (
        capabilities IN (
            '["content.transform"]'::jsonb,
            '["ui.panel"]'::jsonb,
            '["content.transform", "ui.panel"]'::jsonb
        )
    ),
    CONSTRAINT plugins_component_size_valid CHECK (
        octet_length(component_bytes) BETWEEN 1 AND 8388608
    ),
    CONSTRAINT plugins_component_sha256_valid CHECK (
        component_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT plugins_status_valid CHECK (status IN ('disabled', 'enabled')),
    CONSTRAINT plugins_revision_positive CHECK (revision > 0)
);

CREATE INDEX plugins_status_key_idx ON plugins (status, key);

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (
        gen_random_uuid(),
        'plugins.read',
        'Read plugins',
        'Read installed plugin metadata and lifecycle state.'
    ),
    (
        gen_random_uuid(),
        'plugins.install',
        'Install plugins',
        'Install validated WebAssembly Component plugins.'
    ),
    (
        gen_random_uuid(),
        'plugins.lifecycle',
        'Manage plugin lifecycle',
        'Enable, disable, and uninstall plugins.'
    ),
    (
        gen_random_uuid(),
        'plugins.invoke',
        'Invoke plugins',
        'Invoke enabled plugins through declared capabilities.'
    )
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key IN (
      'plugins.read',
      'plugins.install',
      'plugins.lifecycle',
      'plugins.invoke'
  )
ON CONFLICT DO NOTHING;
