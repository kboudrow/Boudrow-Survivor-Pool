revoke select on table public.pools from anon,authenticated;

grant select(
  id,name,season,is_public,visibility,allow_discovery,start_week,include_playoffs,
  strikes_allowed,mulligans,tie_rule,ties,deadline,deadline_mode,deadline_fixed,
  notes,image_url,created_by,created_at,activation_status,activated_at,activated_by,
  archived,archived_at,max_members,allow_multiple_entries,max_entries_per_user,
  double_pick_weeks,plan,pick_privacy,payment_status,pinned_rank,sponsored_until,
  cloned_from_pool_id,test_mode,test_current_week,test_now_at,winner_user_id,name_normalized
) on table public.pools to anon,authenticated;

-- Password hashes and payment-provider identifiers intentionally remain
-- available only to trusted server-side/service-role code.
