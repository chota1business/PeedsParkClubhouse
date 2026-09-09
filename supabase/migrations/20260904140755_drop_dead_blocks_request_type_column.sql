-- Restored from the applied production migration history; no customer data.
-- Dead column: an earlier, simpler attempt at item 10 (block "request type"),
-- superseded by the fuller unified_blocks system (block_type, admin-v2/blocks.html).
-- Never read by any function/view; safe to drop.
ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_request_type_check;
ALTER TABLE public.blocks DROP COLUMN IF EXISTS request_type;
