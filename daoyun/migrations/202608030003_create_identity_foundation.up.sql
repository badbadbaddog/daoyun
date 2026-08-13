CREATE TABLE users (
    id uuid PRIMARY KEY,
    username varchar(32) NOT NULL,
    email varchar(254) NOT NULL,
    display_name varchar(80) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_username_format CHECK (username ~ '^[a-z][a-z0-9_]{2,31}$'),
    CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
    CONSTRAINT users_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 80),
    CONSTRAINT users_display_name_no_control CHECK (display_name !~ '[[:cntrl:]]'),
    CONSTRAINT users_status_valid CHECK (status IN ('active', 'suspended'))
);

CREATE UNIQUE INDEX users_username_unique ON users (username);
CREATE UNIQUE INDEX users_email_case_insensitive_unique ON users (lower(email));

CREATE TABLE password_credentials (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    password_hash varchar(512) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT password_credentials_argon2id_v19 CHECK (
        password_hash LIKE '$argon2id$v=19$%'
    )
);

CREATE TABLE roles (
    id uuid PRIMARY KEY,
    key varchar(64) NOT NULL UNIQUE,
    name varchar(80) NOT NULL,
    scope varchar(16) NOT NULL,
    is_system boolean NOT NULL DEFAULT FALSE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT roles_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT roles_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT roles_scope_valid CHECK (scope IN ('instance', 'site', 'board'))
);

CREATE TABLE role_assignments (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    assigned_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT role_assignments_user_role_unique UNIQUE (user_id, role_id)
);

CREATE INDEX role_assignments_role_id_index ON role_assignments (role_id);
