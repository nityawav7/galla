import { Document, Page, Text, View } from "@react-pdf/renderer";
import { type ReactNode } from "react";

import { type PrintableLine } from "@/server/domain/invoice/printable";

import { PDF_FONTS } from "./fonts";
import {
  CancelledStamp,
  documentTitle,
  INK,
  KeyValue,
  MUTED,
  PartyLines,
  RULE,
  UpiQr,
} from "./parts";
import { type DocumentPdfProps } from "./types";

/*
 * A4 portrait invoice or credit note with every Rule 46 field (SPEC §4.7). Rows never split
 * across pages; long documents continue on the next page with "Page x of y" at the foot.
 */

const BASE = 8.5;
const SMALL = 7.5;

interface Column {
  key: string;
  label: string;
  width: number;
  align: "left" | "right";
  cell: (line: PrintableLine) => ReactNode;
}

function columns({ doc, t }: DocumentPdfProps): Column[] {
  const fixed: Column[] = [
    {
      key: "position",
      label: t("columns.position"),
      width: 4,
      align: "left",
      cell: (l) => String(l.position),
    },
    { key: "hsn", label: t("columns.hsn"), width: 9, align: "left", cell: (l) => l.hsnSac ?? "" },
    {
      key: "qty",
      label: t("columns.qty"),
      width: 9,
      align: "right",
      cell: (l) => `${l.qty} ${l.unit}`,
    },
    {
      key: "price",
      label: t("columns.price"),
      width: 10,
      align: "right",
      cell: (l) => l.unitPrice,
    },
    {
      key: "discount",
      label: t("columns.discount"),
      width: 8,
      align: "right",
      cell: (l) => l.discount,
    },
    {
      key: "taxable",
      label: t("columns.taxable"),
      width: 11,
      align: "right",
      cell: (l) => l.taxable,
    },
    ...doc.taxKinds.map((kind, index): Column => ({
      key: kind,
      label: t(`tax.${kind}`),
      width: 9,
      align: "right",
      cell: (l) => (
        <>
          <Text style={{ fontSize: SMALL, color: MUTED }}>{l.taxes[index]?.rate}</Text>
          <Text>{l.taxes[index]?.amount}</Text>
        </>
      ),
    })),
    { key: "total", label: t("columns.total"), width: 11, align: "right", cell: (l) => l.total },
  ];
  const used = fixed.reduce((sum, column) => sum + column.width, 0);
  const item: Column = {
    key: "item",
    label: t("columns.item"),
    width: 100 - used,
    align: "left",
    cell: (l) => l.description,
  };
  return [fixed[0], item, ...fixed.slice(1)].filter((column): column is Column => Boolean(column));
}

function Row({
  cells,
  header = false,
}: {
  cells: { column: Column; content: ReactNode }[];
  header?: boolean;
}) {
  return (
    <View
      wrap={false}
      style={{
        flexDirection: "row",
        borderBottomWidth: header ? 1 : 0.5,
        borderBottomColor: header ? INK : RULE,
        paddingVertical: 3,
      }}
    >
      {cells.map(({ column, content }) => (
        <View key={column.key} style={{ width: `${String(column.width)}%`, paddingHorizontal: 2 }}>
          {typeof content === "string" ? (
            <Text
              style={{
                textAlign: column.align,
                fontWeight: header ? 700 : 400,
                fontSize: header ? SMALL : BASE,
              }}
            >
              {content}
            </Text>
          ) : (
            <View style={{ alignItems: column.align === "right" ? "flex-end" : "flex-start" }}>
              {content}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text style={{ fontSize: SMALL, color: MUTED, fontWeight: 700, marginBottom: 2 }}>
      {children.toUpperCase()}
    </Text>
  );
}

export function DocumentA4(props: DocumentPdfProps) {
  const { doc, creditNote, payment, bank, cancelled, t } = props;
  const title = documentTitle(props);
  const cols = columns(props);
  const recipientName = doc.recipient.name ?? t("walkIn");
  return (
    <Document title={`${title} ${doc.number}`} author={doc.supplier.name ?? undefined}>
      <Page
        size="A4"
        style={{
          padding: 32,
          paddingBottom: 48,
          fontFamily: PDF_FONTS,
          fontSize: BASE,
          color: INK,
        }}
      >
        {/* Supplier and document title */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: 700 }}>{doc.supplier.name}</Text>
            <PartyLines party={doc.supplier} t={t} fontSize={BASE} />
          </View>
          <View style={{ alignItems: "flex-end", gap: 4, maxWidth: "45%" }}>
            <Text style={{ fontSize: 16, fontWeight: 700 }}>{title}</Text>
            {doc.type === "BILL_OF_SUPPLY" ? (
              <Text style={{ fontSize: SMALL, textAlign: "right" }}>{t("compositionLine")}</Text>
            ) : null}
            {cancelled ? <CancelledStamp t={t} fontSize={11} /> : null}
          </View>
        </View>

        {/* Document details and parties */}
        <View
          style={{
            flexDirection: "row",
            gap: 16,
            marginTop: 14,
            paddingVertical: 8,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: INK,
          }}
        >
          <View style={{ flex: 1 }}>
            <Label>{t("billedTo")}</Label>
            <Text style={{ fontWeight: 700 }}>{recipientName}</Text>
            <PartyLines party={doc.recipient} t={t} fontSize={BASE} />
            {doc.shipTo ? (
              <View style={{ marginTop: 6 }}>
                <Label>{t("shipTo")}</Label>
                {doc.shipTo.map((line) => (
                  <Text key={line}>{line}</Text>
                ))}
              </View>
            ) : null}
          </View>
          <View style={{ width: "42%", gap: 1 }}>
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
          </View>
        </View>

        {/* Items */}
        <View style={{ marginTop: 10 }}>
          <Row header cells={cols.map((column) => ({ column, content: column.label }))} />
          {doc.lines.map((line) => (
            <Row
              key={line.position}
              cells={cols.map((column) => ({ column, content: column.cell(line) }))}
            />
          ))}
        </View>

        {/* Tax by rate, totals and amount in words */}
        <View wrap={false} style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            {doc.rates.length > 0 ? (
              <>
                <Label>{t("taxSummary")}</Label>
                <View style={{ flexDirection: "row", borderBottomWidth: 0.5, borderColor: RULE }}>
                  <Text style={{ width: "25%", fontSize: SMALL, fontWeight: 700 }}>
                    {t("gstRate")}
                  </Text>
                  <Text
                    style={{ width: "25%", fontSize: SMALL, fontWeight: 700, textAlign: "right" }}
                  >
                    {t("totals.taxable")}
                  </Text>
                  {doc.taxKinds.map((kind) => (
                    <Text
                      key={kind}
                      style={{ flex: 1, fontSize: SMALL, fontWeight: 700, textAlign: "right" }}
                    >
                      {t(`tax.${kind}`)}
                    </Text>
                  ))}
                </View>
                {doc.rates.map((row) => (
                  <View key={row.rate} style={{ flexDirection: "row" }}>
                    <Text style={{ width: "25%" }}>{row.rate}</Text>
                    <Text style={{ width: "25%", textAlign: "right" }}>{row.taxable}</Text>
                    {row.taxes.map((tax, index) => (
                      <Text key={doc.taxKinds[index]} style={{ flex: 1, textAlign: "right" }}>
                        {tax.amount}
                      </Text>
                    ))}
                  </View>
                ))}
              </>
            ) : null}
            <Text style={{ marginTop: 8, fontWeight: 700 }}>{doc.amountInWords}</Text>
          </View>
          <View style={{ width: "38%", gap: 1 }}>
            {doc.totals.map((row) => (
              <KeyValue
                key={row.key}
                label={t(`totals.${row.key}`)}
                value={row.amount}
                fontSize={BASE}
              />
            ))}
            <View style={{ borderTopWidth: 1, borderColor: INK, marginTop: 2, paddingTop: 2 }}>
              <KeyValue
                label={creditNote ? t("creditTotal") : t("grandTotal")}
                value={doc.grandTotal}
                fontSize={11}
                bold
              />
            </View>
          </View>
        </View>

        {/* Payment details */}
        {payment || bank ? (
          <View
            wrap={false}
            style={{
              flexDirection: "row",
              gap: 16,
              marginTop: 12,
              paddingTop: 8,
              borderTopWidth: 0.5,
              borderColor: RULE,
            }}
          >
            {payment ? (
              <View style={{ flexDirection: "row", gap: 8, flex: 1 }}>
                <UpiQr link={payment.upiLink} size={84} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Label>{t("payTitle")}</Label>
                  <Text>{t("scanToPay", { amount: payment.amount })}</Text>
                  <Text>{t("upiId", { vpa: payment.vpa })}</Text>
                </View>
              </View>
            ) : null}
            {bank ? (
              <View style={{ flex: 1, gap: 1 }}>
                <Label>{t("bankTitle")}</Label>
                {bank.accountName ? (
                  <KeyValue label={t("bankAccountName")} value={bank.accountName} fontSize={BASE} />
                ) : null}
                <KeyValue
                  label={t("bankAccountNumber")}
                  value={bank.accountNumber}
                  fontSize={BASE}
                />
                {bank.ifsc ? (
                  <KeyValue label={t("bankIfsc")} value={bank.ifsc} fontSize={BASE} />
                ) : null}
                {bank.bankName ? (
                  <KeyValue label={t("bankName")} value={bank.bankName} fontSize={BASE} />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Notes, terms and signature */}
        <View wrap={false} style={{ flexDirection: "row", gap: 16, marginTop: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            {doc.notes ? (
              <View>
                <Label>{t("notes")}</Label>
                <Text>{doc.notes}</Text>
              </View>
            ) : null}
            {doc.terms && !creditNote ? (
              <View>
                <Label>{t("terms")}</Label>
                <Text style={{ fontSize: SMALL }}>{doc.terms}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ width: "38%", alignItems: "flex-end" }}>
            <Text>{t("forSupplier", { name: doc.supplier.name ?? "" })}</Text>
            <Text style={{ marginTop: 32, color: MUTED }}>{t("signatory")}</Text>
          </View>
        </View>

        <Text
          fixed
          style={{
            position: "absolute",
            bottom: 20,
            left: 32,
            right: 32,
            fontSize: SMALL,
            color: MUTED,
            textAlign: "center",
          }}
          render={({ pageNumber, totalPages }) =>
            t("page", { page: String(pageNumber), total: String(totalPages) })
          }
        />
      </Page>
    </Document>
  );
}
