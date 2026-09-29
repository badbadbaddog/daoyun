-- Host-owned atomic facts for the approved membership.redemption provider.
ALTER TABLE plugins DROP CONSTRAINT plugins_capabilities_valid;
ALTER TABLE plugins ADD CONSTRAINT plugins_capabilities_valid CHECK (
 daoyun_valid_plugin_string_set(capabilities, ARRAY[
 'content.transform','ui.panel','events.subscribe','core.query','points.write','experience.write',
 'entitlements.write','notifications.write','storage.read_write','tasks.schedule',
 'topic.supplements','topic.edit_review','membership.redemption'],1,16));
ALTER TABLE plugins DROP CONSTRAINT plugins_business_contract_consistent;
ALTER TABLE plugins ADD CONSTRAINT plugins_business_contract_consistent CHECK (
 (business_api_version IS NULL AND data_scopes='[]'::jsonb AND capabilities <@ '["content.transform","ui.panel"]'::jsonb)
 OR (business_api_version='0.1.0' AND NOT capabilities ? 'content.transform' AND capabilities ?| ARRAY[
 'events.subscribe','core.query','points.write','experience.write','entitlements.write','notifications.write',
 'storage.read_write','tasks.schedule','topic.supplements','topic.edit_review','membership.redemption']));
CREATE UNIQUE INDEX plugins_one_redemption_provider ON plugins ((true)) WHERE capabilities ? 'membership.redemption';

CREATE TABLE redemption_products (
 id uuid PRIMARY KEY,
 provider_key varchar(64) NOT NULL,
 name varchar(80) NOT NULL CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 80),
 entitlement_type_id uuid NOT NULL,
 type_version integer NOT NULL,
 price bigint NOT NULL CHECK (price BETWEEN 1 AND 1000000),
 duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
 per_user_limit integer NOT NULL CHECK (per_user_limit BETWEEN 1 AND 1000),
 enabled boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (entitlement_type_id,type_version) REFERENCES standard_entitlement_versions(entitlement_type_id,version)
);
CREATE INDEX redemption_products_provider ON redemption_products(provider_key,id DESC);

CREATE TABLE point_redemptions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 product_id uuid NOT NULL REFERENCES redemption_products(id),
 product_revision bigint NOT NULL CHECK (product_revision>0),
 product_name varchar(80) NOT NULL,
 price bigint NOT NULL CHECK (price>0),
 balance_after bigint NOT NULL CHECK (balance_after>=0),
 entitlement_id uuid NOT NULL UNIQUE REFERENCES user_standard_entitlements(id),
 ledger_entry_id uuid NOT NULL UNIQUE REFERENCES point_ledger_entries(id),
 idempotency_key varchar(128) NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{1,128}$'),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ends_at timestamptz NOT NULL,
 UNIQUE(user_id,idempotency_key),
 CHECK(ends_at>created_at)
);
CREATE INDEX point_redemptions_user ON point_redemptions(user_id,id DESC);
CREATE INDEX point_redemptions_limit ON point_redemptions(user_id,product_id);

INSERT INTO permissions(id,permission_key,name,description) VALUES
 (daoyun_uuid_v7(),'membership.redemptions.read','Read redemption products','Read points redemption products.'),
 (daoyun_uuid_v7(),'membership.redemptions.write','Manage redemption products','Publish and withdraw points redemption products.')
ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key='super_admin' AND p.permission_key IN ('membership.redemptions.read','membership.redemptions.write')
 ON CONFLICT DO NOTHING;
