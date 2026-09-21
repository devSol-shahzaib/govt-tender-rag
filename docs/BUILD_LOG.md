# Build log

Dated notes written at the end of each feature. Facts, numbers, what broke, what was learned. This is the raw material for the blog series, so be specific.

Entry format:

```
## YYYY-MM-DD  FNNN Feature name
What was built:
Numbers:
What broke / surprised me:
What I learned:
Blog material:
```

---

## 2026-09-19  Corpus collection and audit
What was built: Corpus of public tenders from EPADS (federal) and KP Health Department, plus an audit script (`scripts/audit-corpus.mjs`) checking page counts, text layer and sources.csv consistency.
Numbers: 65 files before cleanup, about 58 unique full documents. 88% digital. 6 scanned, 2 mixed. 8 tenders with original plus amendment.
What broke / surprised me: Every scanned file is a corrigendum or pre-bid minutes. The documents that change the answers are the ones a text-only pipeline can't read. EPADS only exposes the latest merged version of a tender, so original plus corrigendum pairs had to come from agency sites. Even digital EPADS files have about 12 near-empty form pages, so "digital" had to be defined as 75%+ of pages with text. Found a triple duplicate saved under three names.
What I learned: Tender notices are not tender documents. Corrigenda override the original. Printed page numbers don't match physical pages.
Blog material: Post 1 (what I'm building and what I expect to break), and the opening of the "confident nonsense" post.
