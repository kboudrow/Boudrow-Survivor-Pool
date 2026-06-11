# NFL Survivor Pool Testing Checklist

Use this as a side-by-side checklist while testing. You do not need to test everything in one sitting.

Recommended setup:
- Use one admin/creator account.
- Use one standard player account.
- Create one fresh test pool.
- Use Stripe sandbox/test mode only.
- Keep notes under any item that fails, feels confusing, or looks ugly.

## 1. Sign In And Navigation

- [ ] Logged-out homepage loads without errors.
  - Notes:

- [ ] Top-right button says Sign in when logged out.
  - Notes:

- [ ] Sign in opens the sign-in options, not automatic Google login.
  - Notes:

- [ ] Google sign-in works.
  - Notes:

- [ ] Email/password sign-in or account creation works if tested.
  - Notes:

- [ ] Logged-out Create Pool / Join Pool paths send user to sign in or clearly explain sign-in is required.
  - Notes:

- [ ] Top navigation buttons work after signing in.
  - Notes:

- [ ] Profile is reachable after signing in.
  - Notes:

- [ ] Sign out works from the top bar.
  - Notes:

## 2. Create Pool And Stripe Activation

- [ ] Admin can open Create Pool while signed in.
  - Notes:

- [ ] New pool defaults Tie Counts As to Loss.
  - Notes:

- [ ] Admin can create a new pool with a clear name.
  - Test pool name:
  - Notes:

- [ ] After creation, admin lands on the admin/pool area.
  - Notes:

- [ ] New pool shows draft/payment-required activation state before payment.
  - Notes:

- [ ] Activate for $50 opens Stripe checkout.
  - Notes:

- [ ] Stripe test payment succeeds with the test card.
  - Notes:

- [ ] After payment, admin returns to the admin panel.
  - Notes:

- [ ] Activation bar disappears after successful payment.
  - Notes:

- [ ] Pool shows as active/paid and joinable.
  - Notes:

## 3. Join/Search Flow

- [ ] Standard player can open Join Pool while signed in.
  - Notes:

- [ ] Search finds the test pool by name.
  - Notes:

- [ ] Search results show useful labels: public/private, joined, your pool, member limit.
  - Notes:

- [ ] Public pool can be joined without a password.
  - Notes:

- [ ] Private pool asks for a password.
  - Notes:

- [ ] Wrong private password shows a clear error inside the join modal.
  - Notes:

- [ ] Correct private password allows join.
  - Notes:

- [ ] Full pool cannot be joined and shows a clear message.
  - Notes:

- [ ] After joining, player is taken directly to that pool.
  - Notes:

- [ ] Joined pool appears under My Pools.
  - Notes:

- [ ] If player tries joining again, message makes sense and offers Open Pool.
  - Notes:

## 4. Pool Members And Standings

- [ ] My Pools opens a selected pool without Failed to load pool errors.
  - Notes:

- [ ] Pool Members tab shows the admin/creator.
  - Notes:

- [ ] Pool Members tab shows the standard player after joining.
  - Notes:

- [ ] Member count matches the actual member list.
  - Notes:

- [ ] Standings tab lists all pool members.
  - Notes:

- [ ] Alive vs eliminated count makes sense.
  - Notes:

- [ ] Wins/losses/pushes display clearly.
  - Notes:

- [ ] Strikes display clearly.
  - Notes:

## 5. Standard Player Picks

- [ ] Player can view Week 1 matchups.
  - Notes:

- [ ] Week 1 teams are not incorrectly locked before the 2026 season.
  - Notes:

- [ ] Player can select a Week 1 team.
  - Selected team:
  - Notes:

- [ ] Selection shows a clear saved confirmation with the team/logo.
  - Notes:

- [ ] Pick card shows Editable draft after saving.
  - Notes:

- [ ] Editable draft can be changed before lock.
  - Notes:

- [ ] Editable draft can be cleared before lock.
  - Notes:

- [ ] Pick remains saved after refresh.
  - Notes:

- [ ] Pick remains saved after leaving and returning to the pool.
  - Notes:

- [ ] Official locked picks show as Official locked and cannot be changed.
  - Notes:

- [ ] Player cannot pick the same team twice in later weeks.
  - Notes:

- [ ] Pick deadline/lock message makes sense.
  - Notes:

- [ ] If a week has two picks enabled, player can make both picks.
  - Week:
  - Pick 1:
  - Pick 2:
  - Notes:

- [ ] Player cannot use the same team for both picks in a double-pick week.
  - Notes:

## 6. Admin League Settings

- [ ] Admin panel loads for the pool creator.
  - Notes:

- [ ] Admin Panel button is visible to the pool creator.
  - Notes:

- [ ] Admin Panel button is not visible to a normal player.
  - Notes:

- [ ] Admin setup summary shows activation, visibility, settings lock, and double-pick count.
  - Notes:

- [ ] Member limit can be changed before the league starts.
  - New limit:
  - Notes:

- [ ] Member limit cannot be set below the current member count.
  - Notes:

- [ ] Public pool can be changed to private before league start.
  - Notes:

- [ ] Switching to private requires a password.
  - Notes:

- [ ] Private pool can be changed back to public before league start.
  - Notes:

- [ ] Double-pick weeks can be selected with the week buttons.
  - Weeks:
  - Notes:

- [ ] Double-pick weeks can also be typed with commas, like `3,6,10`.
  - Notes:

- [ ] Double-pick weeks show correctly on the player pool page.
  - Notes:

- [ ] Archive/unarchive works before the league starts.
  - Notes:

- [ ] New 2026 pools do not incorrectly show league settings as locked.
  - Notes:

- [ ] Once the league reaches its configured start week, league settings are locked.
  - Notes:

- [ ] After start, admin can still manage player picks/results.
  - Notes:

## 7. Admin Pick Controls

- [ ] Admin can select a week in Members & Picks.
  - Notes:

- [ ] Pending draft column is understandable.
  - Notes:

- [ ] Official final pick column is understandable.
  - Notes:

- [ ] Admin can save a pending draft for a player before it is final.
  - Player:
  - Team:
  - Notes:

- [ ] Once a pick is final, draft changes are locked for that slot.
  - Notes:

- [ ] Admin can override a final pick before kickoff.
  - Player:
  - Team:
  - Notes:

- [ ] Overriding an existing final pick asks for confirmation.
  - Notes:

- [ ] If a result already exists, admin sees warning that override will clear it.
  - Notes:

- [ ] Remove member works before league start.
  - Notes:

- [ ] Remove member is disabled after league start.
  - Notes:

## 8. Results Maintenance

- [ ] Admin Finalize locked picks button works when there are lockable picks.
  - Notes:

- [ ] Finalized player pick moves from Editable draft to Official locked.
  - Notes:

- [ ] Admin Adjudicate results button works after game results exist.
  - Notes:

- [ ] Tie counts as loss pools score ties as losses.
  - Notes:

- [ ] Tie counts as win/push pools score ties correctly if tested.
  - Notes:

## 9. Profile And History

- [ ] Profile page loads.
  - Notes:

- [ ] Player Identity section shows complete/incomplete status.
  - Notes:

- [ ] Missing display name shows Profile incomplete.
  - Notes:

- [ ] Saving display name updates the profile.
  - Notes:

- [ ] Display name appears in member lists/standings.
  - Notes:

- [ ] Mismatched password update shows a clear error.
  - Notes:

- [ ] Valid password update succeeds if tested.
  - Notes:

- [ ] Email update flow shows useful messaging if tested.
  - Notes:

- [ ] History is reachable from profile.
  - Notes:

- [ ] History does not clutter the main navigation.
  - Notes:

## 10. Mobile / Small Screen Quick Check

- [ ] Homepage is usable on a phone-sized screen.
  - Notes:

- [ ] Join/search page is usable on a phone-sized screen.
  - Notes:

- [ ] Pool page is usable on a phone-sized screen.
  - Notes:

- [ ] Pick cards are usable on a phone-sized screen.
  - Notes:

- [ ] Admin page is usable enough on a phone-sized screen.
  - Notes:

- [ ] Profile page is usable on a phone-sized screen.
  - Notes:

## 11. Issues To Bring Back To Codex

Use this section for anything that fails, feels confusing, or looks ugly.

1.

2.

3.

4.

5.
