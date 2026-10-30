# Golden invoices: hand calculations

The ten invoices in `tests/fixtures/invoices/` were worked out by hand with the SPEC §4.5 formulas below. The test `tests/unit/server/domain/golden-fixtures.test.ts` checks that the code produces exactly these numbers.

**Please check at least five by hand (01, 03, 04, 06, 09 are a good set), ideally with an accountant.** A phone calculator is enough. Tick them off in the table at the end.

## Rules used

- **Rounding:** to the nearest paisa; exactly half a paisa rounds **up** (12.5 → 13 paise).
- **Gross** = quantity × price.
- **Price includes tax:** taxable = gross × 100 / (100 + rate).
- **Discount** is taken off the taxable value before tax.
- **Same state:** CGST = SGST (or UTGST) = taxable × (rate ÷ 2), each rounded separately.
- **Other state:** IGST = taxable × rate.
- **Line total** = taxable + taxes. **Invoice totals** = sum of the line values.
- **Round off** (when on) moves the total to the nearest rupee; 50 paise rounds up.
- **Composition / unregistered:** no tax at all; "price includes tax" is ignored.

---

## 01 Walk-in customer, Maharashtra (prices before tax, round-off on)

Customer has no state, so place of supply = shop's state **27**, so CGST + SGST.

| Line                       | Working               | Taxable | CGST  | SGST  | Total  |
| -------------------------- | --------------------- | ------- | ----- | ----- | ------ |
| Rice 2 × ₹250.00 @ 5%      | 500.00 × 2.5% = 12.50 | 500.00  | 12.50 | 12.50 | 525.00 |
| Detergent 3 × ₹99.00 @ 18% | 297.00 × 9% = 26.73   | 297.00  | 26.73 | 26.73 | 350.46 |

Sub-total 525.00 + 350.46 = **875.46**, so round off **−0.46**, giving a grand total of **₹875.00**.
"Rupees Eight Hundred Seventy Five Only".

## 02 Maharashtra → Karnataka business (no round-off)

Place of supply **29** ≠ 27, so IGST.

| Line                      | Working              | Taxable | IGST  | Total   |
| ------------------------- | -------------------- | ------- | ----- | ------- |
| Tumbler 10 × ₹45.50 @ 18% | 455.00 × 18% = 81.90 | 455.00  | 81.90 | 536.90  |
| Cooker 1 × ₹1,200.00 @ 5% | 1200.00 × 5% = 60.00 | 1200.00 | 60.00 | 1260.00 |

Grand total **₹1,796.90**. "Rupees One Thousand Seven Hundred Ninety Six and Ninety Paise Only".

## 03 MRP prices that include GST (intra-state, round-off on)

| Line                     | Taxable = gross × 100/(100+r)         | Half tax                     | Total                  |
| ------------------------ | ------------------------------------- | ---------------------------- | ---------------------- |
| Shampoo 1 × ₹118 @ 18%   | 118 × 100/118 = **100.00**            | 100.00 × 9% = 9.00           | 118.00                 |
| Ghee 2 × ₹55 = 110 @ 5%  | 110 × 100/105 = 104.7619 → **104.76** | 104.76 × 2.5% = 2.619 → 2.62 | 104.76 + 5.24 = 110.00 |
| Toothpaste 1 × ₹99 @ 18% | 99 × 100/118 = 83.8983 → **83.90**    | 83.90 × 9% = 7.551 → 7.55    | 83.90 + 15.10 = 99.00  |
| Biscuits 1 × ₹10 @ 18%   | 10 × 100/118 = 8.4746 → **8.47**      | 8.47 × 9% = 0.7623 → 0.76    | 8.47 + 1.52 = **9.99** |

The biscuits line lands 1 paisa under MRP. That is the expected rounding effect, and the SPEC allows at most 1 paisa.
Taxable 297.13, CGST 19.93, SGST 19.93, sub-total 336.99, round off **+0.01**, grand total **₹337.00**.

## 04 Discounts before tax (intra-state, round-off on)

| Line                                  | Working                                             | Taxable | CGST = SGST | Total   |
| ------------------------------------- | --------------------------------------------------- | ------- | ----------- | ------- |
| Mixer 1 × ₹1,500 @ 18%, discount ₹150 | 1500 − 150 = 1350; 1350 × 9% = 121.50               | 1350.00 | 121.50      | 1593.00 |
| Tea 4 × ₹62.50 @ 5%, discount ₹12.50  | 250 − 12.50 = 237.50; 237.50 × 2.5% = 5.9375 → 5.94 | 237.50  | 5.94        | 249.38  |

Discount total 162.50, taxable 1587.50, CGST 127.44, SGST 127.44, sub-total **1842.38**, round off **−0.38**, grand total **₹1,842.00**.

## 05 Fractional quantities (intra-state, no round-off)

| Line                        | Gross                | Half tax                       | Total  |
| --------------------------- | -------------------- | ------------------------------ | ------ |
| Sugar 1.5 kg × ₹44.90 @ 5%  | 67.35                | 67.35 × 2.5% = 1.68375 → 1.68  | 70.71  |
| Cashews 0.25 kg × ₹899 @ 5% | 224.75               | 224.75 × 2.5% = 5.61875 → 5.62 | 235.99 |
| Wire 2.375 m × ₹33.33 @ 18% | 79.15875 → **79.16** | 79.16 × 9% = 7.1244 → 7.12     | 93.40  |

Taxable 371.26, CGST 14.42, SGST 14.42, grand total **₹400.10**. "Rupees Four Hundred and Ten Paise Only".

## 06 Chandigarh (UT without legislature): CGST + UTGST

| Line                    | Working                      | Taxable | CGST  | UTGST | Total  |
| ----------------------- | ---------------------------- | ------- | ----- | ----- | ------ |
| Bedsheet 3 × ₹240 @ 18% | 720 × 9% = 64.80             | 720.00  | 64.80 | 64.80 | 849.60 |
| Notebook 1 × ₹35 @ 5%   | 35 × 2.5% = 0.875 → **0.88** | 35.00   | 0.88  | 0.88  | 36.76  |

Taxable 755.00, CGST 65.68, UTGST 65.68, SGST 0, sub-total **886.36**, round off **−0.36**, grand total **₹886.00**.

## 07 Composition dealer: Bill of Supply

No tax lines. The product's 5% rate and "price includes tax" flag are ignored.

| Line                            | Working      | Total  |
| ------------------------------- | ------------ | ------ |
| Namkeen 2 × ₹120                | 240.00       | 240.00 |
| Soap 1 × ₹49.50, discount ₹4.50 | 49.50 − 4.50 | 45.00  |

Grand total **₹285.00**. Round-off is on but has nothing to do.

## 08 Special rates 0.25% and 3% (Gujarat, intra-state, no round-off)

| Line                        | Half rate | Half tax                                         | Total     |
| --------------------------- | --------- | ------------------------------------------------ | --------- |
| Diamond lot ₹10,000 @ 0.25% | 0.125%    | 10000 × 0.125% = 12.50                           | 10,025.00 |
| Diamond lot ₹1,001 @ 0.25%  | 0.125%    | 1001 × 0.125% = 1.25125 → 1.25                   | 1,003.50  |
| Stone ₹100 @ 0.25%          | 0.125%    | 100 × 0.125% = 0.125 → **0.13** (half rounds up) | 100.26    |
| Gold coin ₹6,500 @ 3%       | 1.5%      | 6500 × 1.5% = 97.50                              | 6,695.00  |

CGST = SGST = 12.50 + 1.25 + 0.13 + 97.50 = 111.38. Grand total **₹17,823.76**.

On the ₹100 stone, intra-state tax is 2 × 0.13 = 0.26, but inter-state IGST would be 0.25. That is because the two halves must be equal and are each rounded.

## 09 40% rate, Maharashtra → Delhi (IGST, round-off on)

| Line                           | Working                                                        | Taxable | IGST   | Total      |
| ------------------------------ | -------------------------------------------------------------- | ------- | ------ | ---------- |
| Drink 24 × ₹40 = 960 incl. 40% | 960 × 100/140 = 685.714 → **685.71**; × 40% = 274.284 → 274.28 | 685.71  | 274.28 | **959.99** |
| Luxury item ₹2,499 @ 40%       | 2499 × 40% = 999.60                                            | 2499.00 | 999.60 | 3498.60    |

Sub-total **4458.59**, round off **+0.41**, grand total **₹4,459.00**.

## 10 Billed in Maharashtra, shipped to Goa (IGST, round-off on)

The shipping state (30 Goa) decides the place of supply, so the sale is inter-state.

| Line                                          | Working                                                     | Taxable | IGST   | Total   |
| --------------------------------------------- | ----------------------------------------------------------- | ------- | ------ | ------- |
| Fan ₹1,180 incl. 18%, discount ₹100           | 1180 × 100/118 = 1000; − 100 = 900; × 18% = 162             | 900.00  | 162.00 | 1062.00 |
| Paint 2.5 L × ₹64 @ 5%                        | 160 × 5% = 8                                                | 160.00  | 8.00   | 168.00  |
| Vegetables 6 × ₹12 @ 0%                       | no tax                                                      | 72.00   | 0.00   | 72.00   |
| Honey ₹349 incl. 5%                           | 349 × 100/105 = 332.381 → **332.38**; × 5% = 16.619 → 16.62 | 332.38  | 16.62  | 349.00  |
| Bulb 3 × ₹19.99 = 59.97 @ 18%, discount ₹5.97 | 59.97 − 5.97 = 54.00; × 18% = 9.72                          | 54.00   | 9.72   | 63.72   |

Taxable 1518.38, IGST 196.34, sub-total **1714.72**, round off **+0.28**, grand total **₹1,715.00**.

---

## Sign-off

| Fixture | Checked by | Date | OK? |
| ------- | ---------- | ---- | --- |
| 01      |            |      |     |
| 03      |            |      |     |
| 04      |            |      |     |
| 06      |            |      |     |
| 09      |            |      |     |

## Open questions for a CA

1. Is code **97 Other Territory** charged UTGST? (Assumed yes.)
2. An **unregistered** business billing a customer in another state is allowed with a warning (decided 30 Oct 2026), because a shop selling only exempt goods may legitimately be unregistered. Is a warning enough, or should it be blocked like composition?
3. Rounding of each CGST/SGST half separately (fixture 08) versus rounding the total tax and splitting it: which do CAs expect? SPEC §4.5 says separate equal halves.
