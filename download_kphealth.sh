#!/bin/bash
# Downloads KP Health Department tender files into Documents/kphealth (never overwrites)
cd "$(dirname "$0")/Documents/kphealth" || exit 1
B="https://www.healthkp.gov.pk/public/uploads"
while IFS='|' read -r f u; do
  [ -z "$f" ] && continue
  [ -e "$f" ] && { echo "skip $f"; continue; }
  curl -sSfL --retry 3 --retry-delay 5 --connect-timeout 30 -m 300 -A "Mozilla/5.0" -o "$f" "$B/$u" </dev/null; rc=$?; sleep 2; [ $rc -eq 0 ] && echo "ok   $f" || { echo "FAIL $f"; rm -f "$f"; }
done <<'LIST'
kphealth_bemonc-516119_bidding_document.pdf|news-RFB%20Medical%20Equipment%20PK-HPMU-516119-GO-RFB%20Final.pdf
kphealth_bemonc-516119_corrigendum-1.pdf|news-Corrigendum%20for%20Equipment%20.pdf
kphealth_bemonc-516119_corrigendum-2.pdf|news-2nd%20Corrigendum.pdf
kphealth_bemonc-516119_corrigendum-3.pdf|news-3rd%20corrigendum%20for%20Equipments%20(1).pdf
kphealth_bemonc-516119_addendum-2.pdf|news-44.2.%20Addendum-2%20to%20RFB%20for%20the%20Procurment%20of%20Medical%20equipment%20Final%20version%20with%20Bank.pdf
kphealth_bemonc-516119_prebid_minutes-1.pdf|news-28.1.%20Minutes%20of%2013-04-2026%20Pre-Bid%20Procurement%20of%20Equipment%20PK-HPMU-516119-GO-RFB%20Final.pdf
kphealth_bemonc-516119_prebid_minutes-2.pdf|news-45.%20MOM%20of%20Pre-Bid%20Final.pdf
kphealth_autoclaves-hcip_bidding_document.pdf|news-RFB%20Document%20for%20Autoclaves%20Final.pdf
kphealth_autoclaves-hcip_addendum-1.pdf|news-26_Adendum%20No_1_MODIFICATIONS%20AFTER%20THE%20PRE%20Bid.pdf
kphealth_autoclaves-hcip_corrigendum-1.pdf|news-DOC-20260305-WA0023..pdf
kphealth_mcc-2026-27_bidding_document.pdf|news-Bid%20Solicitation%20Documents%20(BSD)%20of%20Govt.%20MCC%20for%20FY%202026-27.pdf
kphealth_mcc-2026-27_revised.pdf|news-Corrigendum%20&%20Revised%20BSDs%20of%20Govt.%20MCC%20FY%202026-27.pdf
kphealth_antimalaria-2025-26_revised.pdf|news-Revised%20BSDs%20FRAMEWORK%20CONTRACT%20FOR%20THE%20PROCUREMENT%20OF%20ANTI-MALARIAL,%20ANTI-DENGUE%20AND%20LEISHMANIASIS%20ITEMS%20FOR%20THE%20FY%202025-26.pdf
kphealth_antimalaria-2025-26_bidding_document.pdf|news-FRAMEWORK%20CONTRACT%20FOR%20THE%20PROCUREMENT%20OF%20ANTI-MALARIAL,%20ANTI-DENGUE%20AND%20LEISHMANIASIS%20ITEMS%20FOR%20THE%20FY%202025-26.pdf
kphealth_antimalaria-2025-26_corrigendum-1.pdf|news-CamScanner%2019-02-2026%2013.20_2.pdf
kphealth_furniture-hcip_bidding_document.pdf|news-11.%20RFB%20NBD%20Procurement%20of%20Furniture%20Dec%2016%20Final%2016-12-25%20(1).pdf
kphealth_furniture-hcip_prebid_minutes.pdf|news-furniture%20pre%20bid%20meeting%20minutes%20.pdf
kphealth_furniture-hcip_revised.pdf|news-RFB%20NBD%20Procurement%20of%20Furniture%20Jan%2001%20Final%20after%20Pre-Bid.pdf
kphealth_furniture-hcip_corrigendum-1.pdf|news-13.4.%20Corrigendum.pdf
kphealth_solarization-hcip_bidding_document.pdf|news-Complete%20Bidding%20Document%20Solarization%20of%20HFs.pdf
kphealth_solarization-hcip_prebid_minutes.pdf|news-pre%20bid%20meeting%20minutes%20of%20solar.pdf
kphealth_fp-commodities-hcip_bidding_document.pdf|news-Family%20planning%20commodities%20SPD%20Request%20for%20Bids%20GOODS%202%20envelope.pdf
kphealth_fp-commodities-hcip_addendum-1.pdf|news-Addendum%20to%20SPN,%20FP%20Commodities.pdf
kphealth_fp-commodities-hcip_revised.pdf|news-RFB%20Family%20Planning%20Commodities%20Final%20(3).pdf
kphealth_med-equip-2026-27_bidding_document.pdf|news-BSDs%20for%20Selection%20and%20Rate%20Contracting%20of%20Medical%20Equipment,%20Medical%20Furniture,%20Instruments%20and%20other%20hospital%20supplies%20for%20the%20Financial%20Year%202026-27.pdf
kphealth_med-equip-2026-27_revised.pdf|news-Prebid%20Minutes%20and%20BSDs%20after%20Prebid%20Meetings%20for%20Selection%20and%20Rate%20Contracting%20of%20Medical%20Equipment,%20Medical%20Furniture,%20Instruments%20and%20other%20hospital%20supplies%20for%20the%20Financial%20Year%202026-27(1).pdf
kphealth_mobile-dtl-2025-26_revised.pdf|news-Revised%20after%20Pre-bid%20BSDs%20for%20equip,%20fabrication%205%20mobile%20labs%20FY%202025-26.pdf
kphealth_fdtl-2026-27_bidding_document.pdf|news-BSDs%20for%20Establishment%20of%20Food%20and%20Drug%20Testing%20Labs%20FY-2026-27.pdf
kphealth_car-rental-hcip_bidding_document.pdf|news-BSD-Car%20Rental%20Services%20Framework%20.pdf
kphealth_car-rental-hcip_revised.pdf|news-BSD_Car%20Rental%20Services%20Framework.pdf
kphealth_stationery-2026-27_bidding_document.pdf|news-BSDs%20for%20Stationay%20and%20Contigency%20Items%202026-27.pdf
LIST
echo "Files in kphealth: $(ls | wc -l)"
