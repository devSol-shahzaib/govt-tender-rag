#!/bin/bash
# Downloads 32 new EPADS bidding documents (none duplicate the existing 9)
cd "$(dirname "$0")/Documents/epads" || exit 1
while read -r name id; do
  f="${name}_p${id}_bidding_document.pdf"
  [ -f "$f" ] && { echo "skip $f"; continue; }
  curl -sSfL -A "Mozilla/5.0" -o "$f" "https://pa.epads.gov.pk/procurement/SBD/p${id}/bidding-document.pdf?download=true" \
    && echo "ok   $f" || { echo "FAIL $f"; rm -f "$f"; }
done <<LIST
tcp 104464
ngc 96607
cda 114952
cda 109270
cda 108850
cda 114889
cda 109237
pseb 110551
paa 108382
pda 115276
tdap 114064
cda 109396
cda 105991
pesco 83917
ismo 120574
cda 110587
hesco 73624
pqa 92854
mepco 119041
mepco 119095
smeda 102856
piahcl 121156
nppmcl 56192
exim 127495
p3a 127309
pr 128074
paa 114271
pr 121966
pr 119659
paa 115765
bsc 118009
pakpost 102751
LIST
echo "Total PDFs: $(ls *.pdf | wc -l)"
