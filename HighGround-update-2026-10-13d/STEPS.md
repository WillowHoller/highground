# HighGround update, 13 Oct (d): ongoing SAVE, PPEL and V-PPEL commitments

Every capital fund pays for some things every year that aren't building projects or debt: technology, equipment, buses, repairs, leases. If those aren't in the plan, the fund looks emptier of commitments than it really is, and the plan shows money "free" that's already spoken for. This update fills these amounts in from the state's data, shows each as a share of the fund's receipts, and flags amounts far outside what districts usually spend. It builds on the 13 Oct two-step update.

## What changes

### Filled in from the state's annual reports
- **Fill in (Starting numbers) and the setup wizard** already put in ongoing SAVE and PPEL spending: the last three years' average, leaving out construction, debt payments and transfers.
- **New: PPEL's figure is now split between PPEL and V-PPEL by the two levy rates**, the same way the balance and receipts are. The state reports regular and voter-approved PPEL as one fund, so the whole amount used to land on regular PPEL, which made PPEL look over-committed and V-PPEL look untouched.
- **The "Compare with the state's annual report" table** shows each ongoing amount with its share of receipts, for example "about 12% of receipts".

### New field: Ongoing V-PPEL commitments
- On **Settings → Starting numbers**, in the V-PPEL card.
- It comes out of V-PPEL **only in the years the levy is collected**, and not at all if a what-if switches the vote off.
- It shows in the Capital plan's **Funding vs. committed** bars as part of what V-PPEL is already committed to.

### Share of receipts, as you type
Under each ongoing field: "That's 12% of SAVE receipts. Typical: 10–25% of SAVE receipts (technology, equipment and recurring maintenance)." Typical ranges used (rules of thumb, not law):

| Fund | Typical ongoing share of receipts |
|---|---|
| SAVE | 10–25% |
| PPEL (regular) | 50–90% |
| V-PPEL | 20–60% (depends on the ballot) |

### Worth a second look
The checks box on Starting numbers now says:
- when an ongoing amount is **under half the low end of its typical range**: the plan will show more of that fund free than there really is, unless those purchases are listed as initiatives;
- when an ongoing amount is **more than the fund's receipts**.

These are checks, not errors: you can still save.

### Bridger Hollow demo: realistic ongoing amounts
- **SAVE:** $150k a year, 12% of receipts. It was $0.
- **PPEL:** $40k a year. Together with the $62k bus lease, that's 75% of PPEL receipts. It was $0.
- **V-PPEL:** $90k a year, 22% of receipts.

The board version's gap rises from $2.92M to **$3.82M**. On Rank & fund, the money now runs out after **#7**, and filling in around the gaps funds **13 of 14** (it was 11 → 13). So the "do more with the same resources" story is stronger. The flyer's screenshot will need retaking after you reload the demo.

## 1. Database (Supabase): do this FIRST

1. Supabase → **SQL Editor** → New query.
2. Paste all of `27_vppel_ongoing.sql` and click **Run**.
3. The result should say **PASS | district_settings.vppel_ongoing**. It's safe to run twice.

Do the database first this time: the new app saves the new column, so saving Starting numbers would fail if the app went up before the column existed. The old app ignores the column, so nothing breaks in between.

## 2. GitHub

1. Go to **github.com/WillowHoller/highground** → **Add file → Upload files**.
2. Drag in everything except STEPS.md (9 files).
3. Commit message: `13 Oct (d) ongoing commitments`
4. Click **Commit changes**.
5. After about 2 minutes, open the app in a private/incognito window.

## 3. Refresh the Bridger Hollow demo (optional, for the new numbers)
The live demo district keeps its old figures until it's reloaded. On the **Willow Holler** page, reload the Bridger Hollow demo data, the same way it was first loaded. Real districts aren't affected: their ongoing amounts change only when someone uses Fill in or edits Starting numbers.

## Numbers that change on screen
- **Bridger Hollow:** as above.
- **Districts with a voter-approved PPEL, after Fill in:** PPEL's ongoing amount drops and V-PPEL gets the rest, split by the levy rates. Regular PPEL has more room; V-PPEL has less.
- **Anything already saved stays as it is** until someone fills in again or edits it.

## Checked before sending
- **Browser tests:** 456 pass, 0 fail: the 453 from before plus 3 new ongoing checks (the share shown and updated as you type, and the second-look tip). The Fill in check now expects PPEL's ongoing amount split by rates.
- **Unit tests:** all 23 files pass, including the new `ongoing_test.js` (11 checks): V-PPEL ongoing only in collected years, not when the vote is off in a what-if, SAVE and PPEL untouched, carried through the database row, and Bridger Hollow inside the typical ranges.
- **Engine regression:** all 32 golden cases unchanged. With no V-PPEL ongoing amount, the math is exactly as before.
- **`report_test.js`:** Bridger Hollow's August report gap now expected at $3.82M.
- **SQL part 27:** run twice on a test database, PASS both times.
