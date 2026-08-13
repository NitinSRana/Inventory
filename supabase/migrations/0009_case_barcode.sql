-- -----------------------------------------------------------------------------
-- Case (outer) barcode and pack size
--
-- Real wholesaler data scans two distinct barcodes: the unit/retail barcode
-- (products.gtin, EAN-13/EAN-8, what's on the item on the shelf) and a
-- separate case/outer barcode on the shipping carton, used when a delivery is
-- received by the case rather than the unit. Case barcodes are commonly
-- ITF-14/GTIN-14, sometimes GTIN-12 — both use the identical GS1 mod-10
-- checksum as EAN-13/EAN-8, just at a different length.
-- -----------------------------------------------------------------------------

alter table public.products
  add column case_gtin text,
  add column units_per_case numeric(10,3) check (units_per_case is null or units_per_case > 0);

create unique index products_org_case_gtin_uniq
  on public.products (organization_id, case_gtin) where case_gtin is not null;
