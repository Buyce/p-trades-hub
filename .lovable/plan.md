## Goal
Make signup/confirmation emails more trustworthy in inboxes and ensure the verification action is a proper clickable link/button.

## Current verified state
- `notify.beinvestlabs.com` is verified and auth emails are enabled for the project.
- No recent delivery events are visible for the shown recipient in the current email log window.
- The screenshot shows Gmail warning on an older default-sender email from `auth.lovable.cloud`, not the verified `notify.beinvestlabs.com` sender.

## Plan
1. **Inspect the live auth email path**
   - Check the current webhook/template code and confirm the published route is using the custom sender domain, not the fallback default sender.
   - Confirm the confirmation URL passed into the template is rendered as a real absolute `href` on the button.

2. **Harden the email templates for clickability**
   - Add a plain text fallback verification URL below the button for signup, invite, recovery, magic-link, and email-change emails.
   - Keep the CTA button as the primary action, but ensure the URL is visible/copyable if an inbox disables button styling or flags the email.
   - Avoid marketing language; keep the content strictly account-related to reduce spam signals.

3. **Reduce spam/phishing signals**
   - Update auth email copy so the displayed brand, sender, and destination are consistent: P-Trades / `beinvestlabs.com` / verified sender domain.
   - Avoid link text that hides the destination in suspicious ways; include the site/domain near the CTA.
   - Keep the email body white and restrained for deliverability.

4. **Verify the resend flow**
   - Check that the `/auth` resend button sends the user through the same custom confirmation email path.
   - If needed, adjust the redirect target to the published/custom app origin rather than a preview or mismatched domain, because domain mismatch is a common spam warning trigger.

5. **Validation**
   - Run a targeted typecheck/test pass for the touched auth email files.
   - Use email logs after a new resend to confirm the event is accepted by the custom email setup.

## Important note
Gmail may continue warning on the old email already in the inbox. The meaningful test is a newly resent confirmation email after these changes are published/resend-triggered.