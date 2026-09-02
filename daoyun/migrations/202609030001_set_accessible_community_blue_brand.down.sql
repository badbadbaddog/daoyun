ALTER TABLE site_branding
    ALTER COLUMN primary_color SET DEFAULT '#2F7BFF';

UPDATE site_branding
SET primary_color = '#2F7BFF',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND lower(primary_color) = '#2563eb';
