ALTER TABLE maxdistrib.orders ADD COLUMN freight_cents integer CHECK (freight_cents >= 0);
ALTER TABLE maxdistrib.orders ADD COLUMN carrier text;
ALTER TABLE maxdistrib.orders ADD COLUMN tracking_code text;
