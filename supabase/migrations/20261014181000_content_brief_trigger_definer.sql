-- The outbox is service-role only, but the enqueue trigger ran as whoever
-- wrote the subscription card. Run it as its owner so a card save from any
-- role (not just the server's service key) can't fail on outbox privileges.
-- search_path is already pinned on the function.
ALTER FUNCTION public.enqueue_content_brief_crm() SECURITY DEFINER;
