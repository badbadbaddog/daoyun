ALTER TABLE site_branding
    ALTER COLUMN primary_color SET DEFAULT '#2563EB';

UPDATE site_branding
SET primary_color = '#2563EB',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND lower(primary_color) = '#2f7bff';
