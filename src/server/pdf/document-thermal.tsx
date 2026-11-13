import { Document, Page, Text, View } from "@react-pdf/renderer";

import { PDF_FONTS } from "./fonts";
import {
  CancelledStamp,
  SampleStamp,
  documentTitle,
  INK,
  KeyValue,
  MUTED,
  PartyLines,
  UpiQr,
} from "./parts";
import { type DocumentPdfProps } from "./types";

/*
 * 80 mm thermal slip: one column, the same Rule 46 fields as A4, tax shown by rate instead of
 * per line. The page is 80 mm wide and as tall as its content (react-pdf sizes it), so the
 * printer cuts once at the end.
 */

/** 80 mm in points. */
const WIDTH = 226.77;
const BASE = 7.5;
const SMALL = 6.5;

function Rule() {
  return (
    <View
      style={{
        borderBottomWidth: 0.75,
        borderColor: INK,
        borderStyle: "dashed",
        marginVertical: 4,
      }}
    />
  );
}

export function DocumentThermal(props: DocumentPdfProps) {
  const { doc, creditNote, payment, cancelled, sample, t } = props;
  const title = documentTitle(props);
  return (
    <Document title={`${title} ${doc.number}`} author={doc.supplier.name ?? undefined}>
      <Page
        size={{ width: WIDTH }}
        style={{ padding: 10, fontFamily: PDF_FONTS, fontSize: BASE, color: INK }}
      >
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 10, fontWeight: 700, textAlign: "center" }}>
            {doc.supplier.name}
          </Text>
          <View style={{ alignItems: "center" }}>
            <PartyLines party={doc.supplier} t={t} fontSize={BASE} />
          </View>
          <Text style={{ fontSize: 9, fontWeight: 700, marginTop: 4 }}>{title}</Text>
          {doc.type === "BILL_OF_SUPPLY" ? (
            <Text style={{ fontSize: SMALL, textAlign: "center" }}>{t("compositionLine")}</Text>
          ) : null}
          {cancelled ? <CancelledStamp t={t} fontSize={9} /> : null}
          {sample ? <SampleStamp t={t} fontSize={9} /> : null}
        </View>
        <Rule />

        <KeyValue
          label={creditNote ? t("creditNoteNumber") : t("invoiceNumber")}
          value={doc.number}
          fontSize={BASE}
          bold
        />
        <KeyValue label={t("date")} value={doc.date} fontSize={BASE} />
        {doc.dueDate && !creditNote ? (
          <KeyValue label={t("dueDate")} value={doc.dueDate} fontSize={BASE} />
        ) : null}
        {creditNote ? (
          <>
            <KeyValue
              label={t("againstInvoice")}
              value={t("againstInvoiceValue", {
                number: creditNote.invoiceNumber,
                date: creditNote.invoiceDate,
              })}
              fontSize={BASE}
            />
            <KeyValue label={t("reason")} value={creditNote.reason} fontSize={BASE} />
          </>
        ) : null}
        <KeyValue label={t("placeOfSupply")} value={doc.placeOfSupply} fontSize={BASE} />
        <KeyValue label={t("reverseCharge")} value={t("no")} fontSize={BASE} />
        <Rule />

        <Text style={{ color: MUTED, fontSize: SMALL }}>{t("billedTo")}</Text>
        <Text style={{ fontWeight: 700 }}>{doc.recipient.name ?? t("walkIn")}</Text>
        <PartyLines party={doc.recipient} t={t} fontSize={BASE} />
        {doc.shipTo ? (
          <>
            <Text style={{ color: MUTED, fontSize: SMALL, marginTop: 2 }}>{t("shipTo")}</Text>
            {doc.shipTo.map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </>
        ) : null}
        <Rule />

        {doc.lines.map((line) => (
          <View key={line.position} style={{ marginBottom: 3 }}>
            <Text style={{ fontWeight: 700 }}>
              {line.position}. {line.description}
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 4 }}>
              <Text style={{ flex: 1 }}>
                {t("lineDetail", { qty: line.qty, unit: line.unit, price: line.unitPrice })}
              </Text>
              <Text>{line.total}</Text>
            </View>
            {line.hasDiscount ? (
              <Text style={{ fontSize: SMALL, color: MUTED }}>
                {t("lineDiscount", { amount: line.discount })}
              </Text>
            ) : null}
            {line.hsnSac || doc.showTax ? (
              <Text style={{ fontSize: SMALL, color: MUTED }}>
                {[
                  line.hsnSac ? t("hsnLine", { hsn: line.hsnSac }) : null,
                  doc.showTax
                    ? line.taxes
                        .map(
                          (tax, index) =>
                            `${t(`tax.${doc.taxKinds[index] ?? "igst"}`)} ${tax.rate}`,
                        )
                        .join(" + ")
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
          </View>
        ))}
        <Rule />

        {doc.totals.map((row) => (
          <KeyValue
            key={row.key}
            label={t(`totals.${row.key}`)}
            value={row.amount}
            fontSize={BASE}
          />
        ))}
        <View style={{ marginTop: 2 }}>
          <KeyValue
            label={creditNote ? t("creditTotal") : t("grandTotal")}
            value={doc.grandTotal}
            fontSize={10}
            bold
          />
        </View>
        <Text style={{ fontSize: SMALL, marginTop: 2 }}>{doc.amountInWords}</Text>

        {doc.rates.length > 0 ? (
          <>
            <Rule />
            <Text style={{ color: MUTED, fontSize: SMALL }}>{t("taxSummary")}</Text>
            {doc.rates.map((row) => (
              <View key={row.rate} style={{ flexDirection: "row", gap: 4 }}>
                <Text style={{ width: 30 }}>{row.rate}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{row.taxable}</Text>
                {row.taxes.map((tax, index) => (
                  <Text key={doc.taxKinds[index]} style={{ flex: 1, textAlign: "right" }}>
                    {tax.amount}
                  </Text>
                ))}
              </View>
            ))}
          </>
        ) : null}

        {payment ? (
          <>
            <Rule />
            <View style={{ alignItems: "center", gap: 2 }}>
              <Text style={{ fontWeight: 700 }}>{t("payTitle")}</Text>
              <UpiQr link={payment.upiLink} size={110} />
              <Text style={{ textAlign: "center" }}>
                {t("scanToPay", { amount: payment.amount })}
              </Text>
              <Text>{t("upiId", { vpa: payment.vpa })}</Text>
            </View>
          </>
        ) : null}

        {doc.notes || (doc.terms && !creditNote) ? <Rule /> : null}
        {doc.notes ? <Text>{doc.notes}</Text> : null}
        {doc.terms && !creditNote ? (
          <Text style={{ fontSize: SMALL, marginTop: 2 }}>{doc.terms}</Text>
        ) : null}

        <Text style={{ marginTop: 14, textAlign: "right", color: MUTED }}>{t("signatory")}</Text>
      </Page>
    </Document>
  );
}
