CREATE TABLE system_state (
    singleton boolean PRIMARY KEY DEFAULT TRUE,
    is_initialized boolean NOT NULL DEFAULT FALSE,
    initialized_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT system_state_singleton CHECK (singleton),
    CONSTRAINT system_state_initialization_consistent CHECK (
        (is_initialized AND initialized_at IS NOT NULL)
        OR (NOT is_initialized AND initialized_at IS NULL)
    )
);

INSERT INTO system_state DEFAULT VALUES;
