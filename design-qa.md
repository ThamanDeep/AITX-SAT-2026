# Design QA — Decision Frontier live dashboard

- Dashboard source: `/Users/tarive/.codex/generated_images/019f7647-23c5-72a1-98ac-eb539ff12ee4/call_I79O6qYFIXqgmbzYRvDVM0za.png`
- Improvement-table source: `/var/folders/2v/_k7jy0rs42941z8ym58lymd80000gn/T/TemporaryItems/NSIRD_screencaptureui_MG2Qsg/Screenshot 2026-07-18 at 2.11.46 PM.png`
- Motion reference: `/Users/tarive/Downloads/Zhengyao_Jiang_-_The_first_experimental_evidence_of_recursive_self-improvement_RSI_ErWfqO.mp4`
- Implementation: `http://127.0.0.1:8787/`
- Comparison: `/tmp/decision-frontier-qa/rsi-table-comparison.png`
- Viewports: 1440 × 1024 desktop; 390 × 844 mobile

## Data and behavior checks

- Hosted Supabase returned 9 live listings: 3 GPU, 3 MacBook, and 3 RAM.
- Six eBay sandbox fixtures are excluded from the live API response.
- GPU and MacBook selection changed the price range, decision, chart, images, and listing URLs.
- Marketplace links use the stored Supabase URL and open in a separate tab.
- The recursive table rendered four policy versions and the trend chart rendered at desktop and mobile sizes.
- Browser console: no current `app.js?v=7` errors.
- Credentials remain server-side in `scripts/dashboard_api.py`.

## Findings resolved

1. **P1 · Data provenance:** Static marketplace fixtures looked live. Replaced them with read-only hosted Supabase queries and visible collection-method labels.
2. **P1 · Trust:** eBay sandbox rows could be mistaken for production results. The API now excludes any collector containing `sandbox`.
3. **P1 · Behavior:** The dashboard and API required two unrelated server commands. The API now also serves the dashboard on port 8787.
4. **P2 · Fidelity:** The recursive table did not match the supplied scorecard. Added all requested columns, confidence intervals, baseline-relative heat cells, rank movement, and legend.
5. **P2 · Comprehension:** A table alone did not show recursion over time. Added an accepted-policy staircase with decision quality and forecast regret, following the video’s champion-progression narrative.
6. **P2 · Honesty:** Screenshot metrics could be read as measured production results. The UI and API label them `illustrative` and explain that Verifiers output must replace them after the first overnight run.
7. **P2 · Responsiveness:** The eight-column table is intentionally horizontally scrollable on mobile; the document itself remains 390px wide with no page-level overflow.

## Final visual check

- Fonts, light rail, warm paper palette, thin borders, pale-green improvements, pale-red regressions, and yellow champion state match the references.
- Product imagery comes from live stored listing URLs; Font Awesome supplies interface icons.
- No custom SVG, CSS illustrations, gradients, fake product art, or unmarked fallback data were introduced.
- The self-improvement chart uses Chart.js and clearly separates decision quality from USD regret.

**final result: passed**
