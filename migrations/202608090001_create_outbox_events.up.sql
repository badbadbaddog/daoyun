CREATE TABLE outbox_events (
    id uuid PRIMARY KEY,
    event_type varchar(80) NOT NULL,
    aggregate_type varchar(40) NOT NULL,
    aggregate_id uuid NOT NULL,
    dedupe_key varchar(160) NOT NULL,
    payload jsonb NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    attempts smallint NOT NULL DEFAULT 0,
    max_attempts smallint NOT NULL DEFAULT 8,
    available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lock_token uuid,
    locked_until timestamptz,
    last_error varchar(500),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT outbox_events_type_format CHECK (
        event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
    ),
    CONSTRAINT outbox_events_aggregate_type_format CHECK (
        aggregate_type ~ '^[a-z][a-z0-9_]{0,39}$'
    ),
    CONSTRAINT outbox_events_dedupe_key_valid CHECK (
        char_length(dedupe_key) BETWEEN 1 AND 160
        AND dedupe_key !~ '[[:cntrl:]]'
    ),
    CONSTRAINT outbox_events_payload_valid CHECK (
        payload <> 'null'::jsonb
        AND octet_length(payload::text) <= 65536
    ),
    CONSTRAINT outbox_events_status_valid CHECK (
        status IN ('pending', 'processing', 'completed', 'dead')
    ),
    CONSTRAINT outbox_events_attempts_valid CHECK (
        attempts BETWEEN 0 AND 25
        AND max_attempts BETWEEN 1 AND 25
        AND attempts <= max_attempts
    ),
    CONSTRAINT outbox_events_error_valid CHECK (
        last_error IS NULL
        OR (
            char_length(last_error) BETWEEN 1 AND 500
            AND last_error !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT outbox_events_state_consistent CHECK (
        (
            status = 'pending'
            AND attempts < max_attempts
            AND lock_token IS NULL
            AND locked_until IS NULL
            AND completed_at IS NULL
        )
        OR (
            status = 'processing'
            AND attempts >= 1
            AND lock_token IS NOT NULL
            AND locked_until IS NOT NULL
            AND completed_at IS NULL
        )
        OR (
            status = 'completed'
            AND attempts >= 1
            AND lock_token IS NULL
            AND locked_until IS NULL
            AND completed_at IS NOT NULL
        )
        OR (
            status = 'dead'
            AND attempts >= 1
            AND lock_token IS NULL
            AND locked_until IS NULL
            AND completed_at IS NULL
            AND last_error IS NOT NULL
        )
    ),
    CONSTRAINT outbox_events_updated_after_created CHECK (updated_at >= created_at),
    CONSTRAINT outbox_events_dedupe_unique UNIQUE (event_type, dedupe_key)
);

CREATE INDEX outbox_events_claim_idx
    ON outbox_events (available_at, created_at, id)
    WHERE status = 'pending';

CREATE INDEX outbox_events_expired_lease_idx
    ON outbox_events (locked_until, id)
    WHERE status = 'processing';

CREATE INDEX outbox_events_aggregate_idx
    ON outbox_events (aggregate_type, aggregate_id, created_at DESC);
