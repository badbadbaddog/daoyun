-- An old binary cannot compile a native record without a retained component.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM plugins WHERE execution='native' AND octet_length(component_bytes)=0) THEN
        RAISE EXCEPTION 'native records require a compatible binary or verified data restore; rollback blocked';
    END IF;
END $$;
ALTER TABLE plugins DROP CONSTRAINT plugins_component_size_valid;
ALTER TABLE plugins ADD CONSTRAINT plugins_component_size_valid CHECK (octet_length(component_bytes) BETWEEN 1 AND 8388608);
ALTER TABLE plugins DROP CONSTRAINT plugins_native_contract_valid;
ALTER TABLE plugins DROP CONSTRAINT plugins_execution_valid;
ALTER TABLE plugins DROP COLUMN execution;
