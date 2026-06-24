# Survive Sunday Beta Testing Checklist

Use this as a side-by-side checklist while testing. You do not need to test everything in one sitting.

Recommended setup:
- Use one admin/creator account.
- Use one standard player account.
- Create one fresh test pool.
- Keep notes under any item that fails, feels confusing, or looks ugly.

Fast beta pass:
- Create a pool, invite one friend, confirm the member and entry counts match everywhere.
- Make picks for every entry you own, then change one before it locks.
- Open standings and confirm usernames, picks, results, and alive counts feel right.
- Read a blog while signed out, then sign in and leave a comment/reply/reaction.
- On mobile, check homepage, blog, join/search, pool page, and profile.

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

- [ ] New account creation asks for a username and prevents duplicate usernames.
  - Notes:

- [ ] Logged-out Create Pool / Join Pool paths send user to sign in or clearly explain sign-in is required.
  - Notes:

- [ ] Top navigation buttons work after signing in.
  - Notes:

- [ ] Profile is reachable after signing in.
  - Notes:

- [ ] Sign out works from the top bar.
  - Notes:

## 2. Create Pool

- [ ] Admin can open Create Pool while signed in.
  - Notes:

- [ ] New pool defaults Tie Counts As to Loss.
  - Notes:

- [ ] Admin can create a new pool with a clear name.
  - Test pool name:
  - Notes:

- [ ] After creation, admin lands on the admin/pool area.
  - Notes:

- [ ] New pool is active and joinable without payment.
  - Notes:

- [ ] Pool image upload works, or a fallback image appears if none is uploaded.
  - Notes:

- [ ] Private pool password field appears directly under the visibility setting.
  - Notes:

- [ ] Multiple-entry setting works, including the max entries dropdown.
  - Notes:

## 3. Join/Search Flow

- [ ] Standard player can open Join Pool while signed in.
  - Notes:

- [ ] Search finds the test pool by name.
  - Notes:

- [ ] Search finds public and private pools.
  - Notes:

- [ ] Search results show useful labels: public/private, joined, your pool, member limit, member count.
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

- [ ] Entry count matches the actual number of entries.
  - Notes:

- [ ] Standings tab lists all entries with usernames only, not real names or emails.
  - Notes:

- [ ] Alive vs eliminated count makes sense.
  - Notes:

- [ ] Wins/losses/pushes display only after games have results.
  - Notes:

- [ ] Strikes display clearly.
  - Notes:

- [ ] Weekly pick distribution shows comment-safe public data only after picks unlock for that week.
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

- [ ] My Pools updates pick status automatically after saving, without manual refresh.
  - Notes:

- [ ] Pick can be changed before lock.
  - Notes:

- [ ] Pick can be cleared before lock.
  - Notes:

- [ ] Pick remains saved after refresh.
  - Notes:

- [ ] Pick remains saved after leaving and returning to the pool.
  - Notes:

- [ ] Picks show as Locked after deadline only after the actual deadline passes.
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

## 6. Admin Pool Settings

- [ ] Admin panel loads for the pool creator.
  - Notes:

- [ ] Admin Panel button is visible to the pool creator.
  - Notes:

- [ ] Admin Panel button is not visible to a normal player.
  - Notes:

- [ ] Admin setup summary shows visibility, settings lock, member limit, and double-pick count.
  - Notes:

- [ ] Member limit can be changed before the pool starts.
  - New limit:
  - Notes:

- [ ] Member limit cannot be set below the current member count.
  - Notes:

- [ ] Public pool can be changed to private before pool start.
  - Notes:

- [ ] Switching to private requires a password.
  - Notes:

- [ ] Private pool can be changed back to public before pool start.
  - Notes:

- [ ] Double-pick weeks can be selected with the week buttons.
  - Weeks:
  - Notes:

- [ ] Double-pick weeks can also be typed with commas, like `3,6,10`.
  - Notes:

- [ ] Double-pick weeks show correctly on the player pool page.
  - Notes:

- [ ] Archive/unarchive works before the pool starts.
  - Notes:

- [ ] New 2026 pools do not incorrectly show pool settings as locked.
  - Notes:

- [ ] Once the pool reaches its configured start week, pool settings are locked.
  - Notes:

- [ ] After start, admin can still manage player picks/results where appropriate.
  - Notes:

## 7. Admin Pick Controls

- [ ] Admin can select a week in Members & Picks.
  - Notes:

- [ ] Admin can submit or edit a user's pick before it locks.
  - Player:
  - Team:
  - Notes:

- [ ] Admin can remove a member before pool start.
  - Notes:

- [ ] Removing a member removes the intended user and no one else.
  - Notes:

- [ ] Admin panel refresh button reloads current member/pick data.
  - Notes:

- [ ] Admin page refreshes automatically after admin actions.
  - Notes:

- [ ] Remove member is disabled after pool start.
  - Notes:

## 8. Results Maintenance

- [ ] Results update automatically after final game data is available.
  - Notes:

- [ ] Future games never show as wins or losses before they are played.
  - Notes:

- [ ] Tie counts as loss pools score ties as losses.
  - Notes:

- [ ] Tie counts as win/push pools score ties correctly if tested.
  - Notes:

- [ ] Any repair or scoring tool is clearly scoped to one pool, not the whole site.
  - Notes:

## 9. Profile And History

- [ ] Profile page loads.
  - Notes:

- [ ] Username section shows complete/incomplete status.
  - Notes:

- [ ] Missing username shows Profile incomplete.
  - Notes:

- [ ] Saving username updates the profile.
  - Notes:

- [ ] Duplicate username shows a clear error.
  - Notes:

- [ ] Uploading a profile picture works.
  - Notes:

- [ ] Profile picture appears in member lists/standings where avatars are shown.
  - Notes:

- [ ] Username appears in member lists/standings.
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

## 10. Blog And Comments

- [ ] Blog homepage loads while signed out.
  - Notes:

- [ ] Blog cards show category, summary, comment count, thumbs-up count, and thumbs-down count.
  - Notes:

- [ ] Category filters do not jump the page unexpectedly.
  - Notes:

- [ ] Individual article pages load while signed out.
  - Notes:

- [ ] Signed-out readers can read comments but must sign in to comment, reply, or react.
  - Notes:

- [ ] Signed-in readers can add a top-level comment.
  - Notes:

- [ ] Signed-in readers can reply to a comment.
  - Notes:

- [ ] Signed-in readers can use ðŸ‘ and ðŸ‘Ž reactions.
  - Notes:

- [ ] Report button submits a comment for review without exposing admin tools.
  - Notes:

- [ ] Comments appear above Share Article.
  - Notes:

- [ ] Share buttons work on desktop and mobile.
  - Notes:

## 11. Blog Admin

- [ ] Blog Admin appears only for the superadmin and invited contributors.
  - Notes:

- [ ] Contributor can submit a draft and immediately see it listed without refreshing.
  - Notes:

- [ ] Contributor cannot publish, archive, delete, manage categories, manage access, or delete comments.
  - Notes:

- [ ] Superadmin can publish, archive, delete, and edit posts.
  - Notes:

- [ ] Superadmin can add categories.
  - Notes:

- [ ] Superadmin can add contributors.
  - Notes:

- [ ] Superadmin can open the Comments tab and see reported comments.
  - Notes:

- [ ] Superadmin can delete a comment.
  - Notes:

- [ ] Deleted comments disappear from public article pages.
  - Notes:

## 12. Mobile / Small Screen Quick Check

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

- [ ] Blog homepage and article pages are usable on a phone-sized screen.
  - Notes:

- [ ] Blog Admin post list is usable on a phone-sized screen.
  - Notes:

- [ ] Profile page is usable on a phone-sized screen.
  - Notes:

## 13. Issues To Bring Back To Codex

Use this section for anything that fails, feels confusing, or looks ugly.

1.

2.

3.

4.

5.


