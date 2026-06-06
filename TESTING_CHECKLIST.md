# NFL Survivor Pool Testing Checklist

Use this as a side-by-side checklist while testing. You do not need to test everything in one sitting.

Recommended setup:
- Use one admin/creator account.
- Use one standard player account.
- Create one fresh test pool.
- Keep notes under any item that fails or feels confusing.

## 1. Sign In And Navigation

- [ ] Logged-out homepage loads without errors.
  - Notes:

- [ ] Top-right button says sign in when logged out.
  - Notes:

- [ ] Sign in opens the sign-in options page, not automatic Google login.
  - Notes:

- [ ] Google sign-in works.
  - Notes:

- [ ] Email/password sign-in or account creation works if tested.
  - Notes:

- [ ] Top navigation buttons work after signing in.
  - Notes:

- [ ] Profile is reachable after signing in.
  - Notes:

- [ ] Sign out works from the top bar.
  - Notes:

## 2. Create Pool And Payment

- [ ] Admin can open Create Pool while signed in.
  - Notes:

- [ ] Create Pool requires sign-in if logged out.
  - Notes:

- [ ] Admin can create a new pool with a clear name.
  - Test pool name:
  - Notes:

- [ ] After creation, admin lands on the pool/admin area.
  - Notes:

- [ ] New pool shows draft/unpaid activation state before payment.
  - Notes:

- [ ] Activate/payment button opens Stripe checkout.
  - Notes:

- [ ] Stripe test payment succeeds with the test card.
  - Notes:

- [ ] After payment, admin returns to the admin panel.
  - Notes:

- [ ] Activation bar disappears after successful payment.
  - Notes:

- [ ] Pool shows as active/paid.
  - Notes:

## 3. Join Pool Flow

- [ ] Standard player can open Join Pool while signed in.
  - Notes:

- [ ] Join Pool requires sign-in if logged out.
  - Notes:

- [ ] Search finds the test pool by name.
  - Notes:

- [ ] Search results are understandable.
  - Notes:

- [ ] Standard player can join the pool.
  - Notes:

- [ ] After joining, player is taken directly to that pool.
  - Notes:

- [ ] Joined pool appears under My Pools.
  - Notes:

- [ ] If player tries joining again, message makes sense and still offers a way into the pool.
  - Notes:

## 4. Standard Player Picks

- [ ] Player can view Week 1 matchups.
  - Notes:

- [ ] Player can select a team.
  - Selected team:
  - Notes:

- [ ] Selection shows clear feedback with the team/logo.
  - Notes:

- [ ] Pick remains saved after refresh.
  - Notes:

- [ ] Pick remains saved after leaving and returning to the pool.
  - Notes:

- [ ] Player cannot pick the same team twice in later weeks.
  - Notes:

- [ ] Pick deadline message makes sense.
  - Notes:

- [ ] If a week has two picks enabled, player can make both picks.
  - Week:
  - Pick 1:
  - Pick 2:
  - Notes:

- [ ] Player cannot use the same team for both picks in a double-pick week.
  - Notes:

## 5. Admin League Settings

- [ ] Admin panel loads for the pool creator.
  - Notes:

- [ ] Admin Panel button is visible to the pool creator.
  - Notes:

- [ ] Admin Panel button is not visible to a normal player.
  - Notes:

- [ ] Member limit can be changed before the league starts.
  - New limit:
  - Notes:

- [ ] Member limit cannot be set below the current member count.
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

- [ ] Once the league reaches its configured start week, league settings are locked.
  - Notes:

- [ ] After start, admin can still manage player picks/results.
  - Notes:

## 6. Admin Pick Controls

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

- [ ] Admin can override a final pick before kickoff.
  - Player:
  - Team:
  - Notes:

- [ ] Overriding an existing final pick asks for confirmation.
  - Notes:

- [ ] Once a pick is final, draft changes are locked for that slot.
  - Notes:

- [ ] If a result already exists, admin sees the warning that override will clear it.
  - Notes:

- [ ] Remove member works before league start.
  - Notes:

- [ ] Remove member is disabled after league start.
  - Notes:

## 7. Standings And Results

- [ ] Standings page/section loads.
  - Notes:

- [ ] Alive players show correctly.
  - Notes:

- [ ] Eliminated players show correctly.
  - Notes:

- [ ] Wins/losses/pushes display clearly.
  - Notes:

- [ ] Strikes display clearly.
  - Notes:

- [ ] Admin Finalize locked picks button works when there are lockable picks.
  - Notes:

- [ ] Admin Adjudicate results button works after game results exist.
  - Notes:

## 8. Profile And History

- [ ] Profile page loads.
  - Notes:

- [ ] Active pools are easy to find.
  - Notes:

- [ ] History is reachable from profile.
  - Notes:

- [ ] History does not clutter the main navigation.
  - Notes:

## 9. Mobile / Small Screen Quick Check

- [ ] Homepage is usable on a phone-sized screen.
  - Notes:

- [ ] Pool page is usable on a phone-sized screen.
  - Notes:

- [ ] Pick selection is usable on a phone-sized screen.
  - Notes:

- [ ] Admin page is usable enough on a phone-sized screen.
  - Notes:

## 10. Issues To Bring Back To Codex

Use this section for anything that fails, feels confusing, or looks ugly.

1.

2.

3.

4.

5.
