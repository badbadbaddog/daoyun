ALTER TABLE user_standard_entitlements ADD COLUMN granted_ends_at timestamptz;
UPDATE user_standard_entitlements SET granted_ends_at = ends_at;

-- Capture the original grant for every producer, including plugin and redemption inserts.
CREATE FUNCTION daoyun_preserve_entitlement_grant_end() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.granted_ends_at := NEW.ends_at;
    ELSIF NEW.granted_ends_at IS DISTINCT FROM OLD.granted_ends_at THEN
        RAISE EXCEPTION 'original entitlement grant end is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_entitlement_grant_end BEFORE INSERT OR UPDATE ON user_standard_entitlements
    FOR EACH ROW EXECUTE FUNCTION daoyun_preserve_entitlement_grant_end();

CREATE TABLE standard_entitlement_renewal_receipts (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    entitlement_id uuid NOT NULL REFERENCES user_standard_entitlements(id),
    actor_id uuid NOT NULL REFERENCES users(id),
    expected_revision bigint NOT NULL CHECK (expected_revision > 0),
    previous_ends_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > previous_ends_at),
    reason varchar(200) NOT NULL CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 1 AND 200 AND reason !~ '[[:cntrl:]]'),
    idempotency_key varchar(64) NOT NULL CHECK (idempotency_key ~ '^[!-~]{1,64}$'),
    revision bigint NOT NULL CHECK (revision = expected_revision + 1),
    audit_id uuid NOT NULL,
    request_id uuid NOT NULL,
    type_version integer NOT NULL CHECK (type_version > 0),
    starts_at timestamptz NOT NULL,
    permission_snapshot varchar(80)[] NOT NULL,
    quota_snapshot jsonb NOT NULL CHECK (daoyun_valid_standard_entitlement_quotas(quota_snapshot)),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (user_id, idempotency_key)
);
CREATE FUNCTION daoyun_immutable_entitlement_renewal_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'entitlement renewal receipts are immutable';
END;
$$;
CREATE TRIGGER immutable_entitlement_renewal_receipt BEFORE UPDATE OR DELETE ON standard_entitlement_renewal_receipts
    FOR EACH ROW EXECUTE FUNCTION daoyun_immutable_entitlement_renewal_receipt();
