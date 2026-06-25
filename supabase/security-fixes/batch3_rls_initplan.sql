-- Batch 3: Rewrite 39 RLS policies so auth.uid() is evaluated once per query, not per row
-- Advisor: auth_rls_initplan — definitions pulled verbatim from pg_policies, only change is
-- auth.uid() -> (select auth.uid()). Atomic: wrapped in a single transaction.
-- https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
BEGIN;

DROP POLICY IF EXISTS cb_categories_select ON public.cash_book_categories;
CREATE POLICY cb_categories_select ON public.cash_book_categories FOR SELECT
  USING ((client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true)))));

DROP POLICY IF EXISTS cb_balances_select ON public.cash_book_daily_balances;
CREATE POLICY cb_balances_select ON public.cash_book_daily_balances FOR SELECT
  USING ((client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true)))));

DROP POLICY IF EXISTS cb_entries_insert ON public.cash_book_entries;
CREATE POLICY cb_entries_insert ON public.cash_book_entries FOR INSERT
  WITH CHECK (((user_id = (select auth.uid())) AND (client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true))))));

DROP POLICY IF EXISTS cb_entries_select ON public.cash_book_entries;
CREATE POLICY cb_entries_select ON public.cash_book_entries FOR SELECT
  USING ((client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true)))));

DROP POLICY IF EXISTS cb_entries_update ON public.cash_book_entries;
CREATE POLICY cb_entries_update ON public.cash_book_entries FOR UPDATE
  USING (((user_id = (select auth.uid())) AND (client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true))))));

DROP POLICY IF EXISTS "Users can insert expense entries for their clients" ON public.cashbook_expense_entries;
CREATE POLICY "Users can insert expense entries for their clients" ON public.cashbook_expense_entries FOR INSERT
  WITH CHECK ((client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true)))));

DROP POLICY IF EXISTS "Users can update expense entries for their clients" ON public.cashbook_expense_entries;
CREATE POLICY "Users can update expense entries for their clients" ON public.cashbook_expense_entries FOR UPDATE
  USING ((client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true)))));

DROP POLICY IF EXISTS "Users can view expense entries for their clients" ON public.cashbook_expense_entries;
CREATE POLICY "Users can view expense entries for their clients" ON public.cashbook_expense_entries FOR SELECT
  USING ((client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true)))));

DROP POLICY IF EXISTS "Members can read channels" ON public.channels;
CREATE POLICY "Members can read channels" ON public.channels FOR SELECT
  USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM workspace_members
  WHERE (workspace_members.user_id = (select auth.uid())))));

DROP POLICY IF EXISTS check_entries_insert ON public.check_entries;
CREATE POLICY check_entries_insert ON public.check_entries FOR INSERT
  WITH CHECK (((user_id = (select auth.uid())) AND (client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true))))));

DROP POLICY IF EXISTS check_entries_select ON public.check_entries;
CREATE POLICY check_entries_select ON public.check_entries FOR SELECT
  USING ((client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true)))));

DROP POLICY IF EXISTS check_entries_update ON public.check_entries;
CREATE POLICY check_entries_update ON public.check_entries FOR UPDATE
  USING (((user_id = (select auth.uid())) AND (client_id IN ( SELECT cash_book_users.client_id
   FROM cash_book_users
  WHERE ((cash_book_users.user_id = (select auth.uid())) AND (cash_book_users.is_active = true))))));

DROP POLICY IF EXISTS "Users can view own daily summaries" ON public.daily_time_summaries;
CREATE POLICY "Users can view own daily summaries" ON public.daily_time_summaries FOR SELECT
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS interest_requests_select_talent ON public.interest_requests;
CREATE POLICY interest_requests_select_talent ON public.interest_requests FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM talent_profiles
  WHERE ((talent_profiles.id = interest_requests.talent_profile_id) AND (talent_profiles.talent_user_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "Channel members can read messages" ON public.messages;
CREATE POLICY "Channel members can read messages" ON public.messages FOR SELECT
  USING ((((channel_id IS NOT NULL) AND (channel_id IN ( SELECT c.id
   FROM (channels c
     JOIN workspace_members wm ON ((wm.workspace_id = c.workspace_id)))
  WHERE (wm.user_id = (select auth.uid()))))) OR ((dm_conversation_id IS NOT NULL) AND (dm_conversation_id IN ( SELECT dm_participants.conversation_id
   FROM dm_participants
  WHERE (dm_participants.user_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Talent users can delete own portfolio items" ON public.portfolio_items;
CREATE POLICY "Talent users can delete own portfolio items" ON public.portfolio_items FOR DELETE
  USING ((profile_id IN ( SELECT talent_profiles.id
   FROM talent_profiles
  WHERE (talent_profiles.talent_user_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Talent users can insert own portfolio items" ON public.portfolio_items;
CREATE POLICY "Talent users can insert own portfolio items" ON public.portfolio_items FOR INSERT
  WITH CHECK ((profile_id IN ( SELECT talent_profiles.id
   FROM talent_profiles
  WHERE (talent_profiles.talent_user_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Talent users can read own portfolio items" ON public.portfolio_items;
CREATE POLICY "Talent users can read own portfolio items" ON public.portfolio_items FOR SELECT
  USING ((profile_id IN ( SELECT talent_profiles.id
   FROM talent_profiles
  WHERE (talent_profiles.talent_user_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Talent users can update own portfolio items" ON public.portfolio_items;
CREATE POLICY "Talent users can update own portfolio items" ON public.portfolio_items FOR UPDATE
  USING ((profile_id IN ( SELECT talent_profiles.id
   FROM talent_profiles
  WHERE (talent_profiles.talent_user_id = (select auth.uid())))));

DROP POLICY IF EXISTS talent_profiles_delete_own ON public.talent_profiles;
CREATE POLICY talent_profiles_delete_own ON public.talent_profiles FOR DELETE
  USING (((select auth.uid()) = talent_user_id));

DROP POLICY IF EXISTS talent_profiles_insert_own ON public.talent_profiles;
CREATE POLICY talent_profiles_insert_own ON public.talent_profiles FOR INSERT
  WITH CHECK (((select auth.uid()) = talent_user_id));

DROP POLICY IF EXISTS talent_profiles_select_own ON public.talent_profiles;
CREATE POLICY talent_profiles_select_own ON public.talent_profiles FOR SELECT
  USING (((select auth.uid()) = talent_user_id));

DROP POLICY IF EXISTS talent_profiles_update_own ON public.talent_profiles;
CREATE POLICY talent_profiles_update_own ON public.talent_profiles FOR UPDATE
  USING (((select auth.uid()) = talent_user_id))
  WITH CHECK (((select auth.uid()) = talent_user_id));

DROP POLICY IF EXISTS "Talent users can insert own basic profile" ON public.talent_profiles_basic;
CREATE POLICY "Talent users can insert own basic profile" ON public.talent_profiles_basic FOR INSERT
  WITH CHECK ((talent_user_id = (select auth.uid())));

DROP POLICY IF EXISTS "Talent users can read own basic profile" ON public.talent_profiles_basic;
CREATE POLICY "Talent users can read own basic profile" ON public.talent_profiles_basic FOR SELECT
  USING ((talent_user_id = (select auth.uid())));

DROP POLICY IF EXISTS "Talent users can update own basic profile" ON public.talent_profiles_basic;
CREATE POLICY "Talent users can update own basic profile" ON public.talent_profiles_basic FOR UPDATE
  USING ((talent_user_id = (select auth.uid())));

DROP POLICY IF EXISTS talent_users_insert_own ON public.talent_users;
CREATE POLICY talent_users_insert_own ON public.talent_users FOR INSERT
  WITH CHECK (((select auth.uid()) = id));

DROP POLICY IF EXISTS talent_users_select_own ON public.talent_users;
CREATE POLICY talent_users_select_own ON public.talent_users FOR SELECT
  USING (((select auth.uid()) = id));

DROP POLICY IF EXISTS talent_users_update_own ON public.talent_users;
CREATE POLICY talent_users_update_own ON public.talent_users FOR UPDATE
  USING (((select auth.uid()) = id))
  WITH CHECK (((select auth.uid()) = id));

DROP POLICY IF EXISTS "Users can insert own task time entries" ON public.task_time_entries;
CREATE POLICY "Users can insert own task time entries" ON public.task_time_entries FOR INSERT
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can view own task time entries" ON public.task_time_entries;
CREATE POLICY "Users can view own task time entries" ON public.task_time_entries FOR SELECT
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can insert own timer sessions" ON public.timer_sessions;
CREATE POLICY "Users can insert own timer sessions" ON public.timer_sessions FOR INSERT
  WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can update own timer sessions" ON public.timer_sessions;
CREATE POLICY "Users can update own timer sessions" ON public.timer_sessions FOR UPDATE
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can view own timer sessions" ON public.timer_sessions;
CREATE POLICY "Users can view own timer sessions" ON public.timer_sessions FOR SELECT
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can view own office timing" ON public.user_office_timing;
CREATE POLICY "Users can view own office timing" ON public.user_office_timing FOR SELECT
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can manage own view prefs" ON public.user_view_preferences;
CREATE POLICY "Users can manage own view prefs" ON public.user_view_preferences FOR ALL
  USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE
  USING (((select auth.uid()) = id));

DROP POLICY IF EXISTS "Members can read workspace members" ON public.workspace_members;
CREATE POLICY "Members can read workspace members" ON public.workspace_members FOR SELECT
  USING ((workspace_id IN ( SELECT wm.workspace_id
   FROM workspace_members wm
  WHERE (wm.user_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Members can read workspaces" ON public.workspaces;
CREATE POLICY "Members can read workspaces" ON public.workspaces FOR SELECT
  USING ((id IN ( SELECT workspace_members.workspace_id
   FROM workspace_members
  WHERE (workspace_members.user_id = (select auth.uid())))));

COMMIT;
