-- Current entitlement ends_at, audit and outbox facts remain. Removed receipts cannot be recovered by up.
DROP TABLE standard_entitlement_renewal_receipts;
DROP FUNCTION daoyun_immutable_entitlement_renewal_receipt();
DROP TRIGGER preserve_entitlement_grant_end ON user_standard_entitlements;
DROP FUNCTION daoyun_preserve_entitlement_grant_end();
ALTER TABLE user_standard_entitlements DROP COLUMN granted_ends_at;
