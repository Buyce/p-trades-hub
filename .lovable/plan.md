## Goal

Show the P-Trades logo in the browser tab instead of the default Lovable icon.

## Current state (verified)

- `public/` contains only `favicon.ico` (the default) and `sw.js`.
- `src/routes/__root.tsx` line 101 declares the single icon link: `{ rel: "icon", href: "/favicon.ico", type: "image/x-icon" }`.
- No logo image files exist in the project source today; the brand mark exists only as an upload.

## Plan

1. Copy the square P-Trades logo mark (the standalone "P" candlestick/arrow mark, `ChatGPT_Image_Jul_28_2026_08_39_19_AM_3.png`) into `public/` as `favicon.png`, plus a 180px-friendly copy as `apple-touch-icon.png` for iOS home-screen use.
2. Update the `links` array in `src/routes/__root.tsx` to reference `/favicon.png` (`type: "image/png"`) and add the apple-touch-icon link, replacing the `/favicon.ico` entry.
3. Delete the default `public/favicon.ico` so stale-icon requests don't serve the old Lovable mark.
4. Verify the tab icon in the preview and confirm the build is green.

## Notes

- The mark version (not the horizontal lockup with wordmark) is used, since a wide logo becomes unreadable at 16-32px.
- No app logic, scanner, or backend code is touched — this is presentation only.
