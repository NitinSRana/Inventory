-- =============================================================================
-- UK VAT defaults
--
-- The product default was 'standard'. In the UK most food is ZERO-rated, and
-- standard-rating is the exception (confectionery, crisps, soft drinks, ice
-- cream, hot food, alcohol). With the old default, every product a UK grocer
-- created or imported was charged 20% at the till.
--
-- 'zero' is the safer default of the two: a band left wrong at zero
-- under-declares VAT on a minority of lines, while a band left wrong at
-- standard OVERCHARGES the customer on the majority of them. Overcharging a
-- shopper is the worse failure, and the one they notice.
-- =============================================================================

alter table public.products
  alter column vat_band set default 'zero';

/*
 * Existing rows are deliberately left alone.
 *
 * A row sitting at 'standard' may have been set there on purpose, and this
 * migration cannot tell the difference between a deliberate 20% and an
 * inherited one. Silently rewriting live prices is worse than leaving them for
 * a human to review — the products list now shows the band so they can be
 * found and corrected.
 *
 * For a brand-new UK tenant with an untouched catalogue, this is safe to run
 * manually after checking it hits only what you expect:
 *
 *   update public.products set vat_band = 'zero'
 *   where organization_id = '<org>' and vat_band = 'standard';
 */
