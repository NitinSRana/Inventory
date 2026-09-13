-- Markdowns: a manager marks one near-expiry batch down, and the till charges
-- that price only for the units FEFO actually takes out of it.
--
-- From the Figma redesign (7P9p7x0R2wp9CqKLruUHrr): the dashboard's "Mitigated
-- losses" card and the till's "PROMO EXPIRY" tag. This reverses CLAUDE.md's
-- "there is no markdown-pricing feature" — the owner chose to build it, as a
-- manager's decision per batch rather than an automatic rule.
--
-- batches.markdown_price is gross, like products.sell_price: what the shopper
-- pays per unit. Who set it and when are kept beside it, because a price cut is
-- money leaving the shop and someone has to be answerable for it.
--
-- sale_lines.list_price is the shelf price at the moment of sale. With it, the
-- money a markdown recovered is a fact stored on the line — the same rule the
-- VAT report follows for rates — rather than something recomputed from today's
-- price, which would restate last month the day someone edits a product.
--
-- One product can now take two lines in a sale: units from a marked-down batch
-- at one price, the rest at shelf price. A blended unit price would be a number
-- nobody printed on a label. So uniqueness moves from (sale, product) to
-- (sale, product, unit_price).
--
-- No RLS changes: every column here lands on a table that already carries its
-- policy and FORCE from 0001_init.sql.

alter table batches
  add column markdown_price numeric(12,4),
  add column marked_down_at timestamptz,
  add column marked_down_by uuid,
  add constraint batches_markdown_price_positive
    check (markdown_price is null or markdown_price > 0);

alter table sale_lines add column list_price numeric(12,4);

-- Every line written before this migration was charged at the shelf price —
-- there was no other price to charge — so its list price is its unit price.
update sale_lines set list_price = unit_price;

alter table sale_lines alter column list_price set not null;

alter table sale_lines drop constraint sale_lines_sale_id_product_id_key;
alter table sale_lines
  add constraint sale_lines_sale_id_product_id_unit_price_key
    unique (sale_id, product_id, unit_price);

comment on column batches.markdown_price is
  'Gross price a manager marked this batch down to. Charged only for units FEFO takes from it.';
comment on column sale_lines.list_price is
  'Shelf price at the moment of sale. unit_price below it means the line sold marked down.';
