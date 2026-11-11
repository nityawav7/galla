import { Document, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";

import { type PrintableParty } from "@/server/domain/invoice/printable";
import { type StatementAmount, type StatementRow } from "@/server/domain/ledger/statement";

import { PDF_FONTS, registerPdfFonts } from "./fonts";
import { INK, KeyValue, MUTED, PartyLines, RULE, UpiQr } from "./parts";
import { type PdfPayment, type PdfTranslator } from "./types";

/*
 * The customer statement (SPEC F7, decision 10 of the Phase 8 plan): A4, the business as it is
 * now, the period's rows with a running balance, the aging of what is due and a UPI QR for it.
 * Labels are English like the invoices; Hindi names print with the Devanagari font.
 */

export interface StatementAging {
  /** Column headings, from AGING_LIMITS: "0–30 days" … "Over 90 days". */
  labels: [string, string, string, string];
  notDue: string;
  pastDue: [string, string, string, string];
  opening: string;
  onAccount: string;
  total: string;
}

export interface StatementPdfProps {
  supplier: PrintableParty;
  customer: PrintableParty;
  /** Formatted dates; `from` is null for all time. */
  period: { from: string | null; to: string };
  broughtForward: StatementAmount | null;
  rows: StatementRow[];
  totals: { debit: string; credit: string };
  closing: StatementAmount;
  aging: StatementAging;
  /** Null when nothing is due or the business has no UPI ID. */
  payment: PdfPayment | null;
  t: PdfTranslator;
}

const BASE = 8.5;
const SMALL = 7.5;

const WIDTHS = { date: "13%", particulars: "39%", debit: "15%", credit: "15%", balance: "18%" };

function balanceText(t: PdfTranslator, value: StatementAmount): string {
  if (value.side === "DR") return t("statement.dr", { amount: value.amount });
  if (value.side === "CR") return t("statement.cr", { amount: value.amount });
  return value.amount;
}

function particulars(t: PdfTranslator, row: StatementRow): string {
  if (row.kind === "OPENING") return t("statement.kinds.OPENING");
  if (row.kind === "INVOICE") return t("statement.kinds.INVOICE", { number: row.number ?? "" });
  if (row.kind === "CREDIT_NOTE") {
    return t("statement.kinds.CREDIT_NOTE", { number: row.number ?? "" });
  }
  const mode = row.mode ? t(`statement.modes.${row.mode as "CASH"}`) : "";
  const text = t(row.kind === "REFUND" ? "statement.kinds.REFUND" : "statement.kinds.PAYMENT", {
    mode,
  });
  return row.reference ? `${text} · ${row.reference}` : text;
}

function Cells({
  values,
  bold = false,
  header = false,
}: {
  values: [string, string, string, string, string];
  bold?: boolean;
  header?: boolean;
}) {
  const keys = ["date", "particulars", "debit", "credit", "balance"] as const;
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
      {keys.map((key, index) => (
        <Text
          key={key}
          style={{
            width: WIDTHS[key],
            paddingHorizontal: 2,
            textAlign: index >= 2 ? "right" : "left",
            fontWeight: bold || header ? 700 : 400,
            fontSize: header ? SMALL : BASE,
          }}
        >
          {values[index]}
        </Text>
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

export function StatementA4(props: StatementPdfProps) {
  const { supplier, customer, period, broughtForward, rows, totals, closing, aging, payment, t } =
    props;
  const title = t("statement.title");
  const periodText = period.from
    ? t("statement.periodValue", { from: period.from, to: period.to })
    : t("statement.periodAll", { to: period.to });
  const agingColumns: [string, string][] = [
    [t("statement.aging.notDue"), aging.notDue],
    ...aging.labels.map((label, index): [string, string] => [label, aging.pastDue[index] ?? ""]),
    [t("statement.aging.opening"), aging.opening],
    [t("statement.aging.onAccount"), aging.onAccount],
    [t("statement.aging.total"), aging.total],
  ];
  return (
    <Document title={`${title} ${customer.name ?? ""}`} author={supplier.name ?? undefined}>
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
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: 700 }}>{supplier.name}</Text>
            <PartyLines party={supplier} t={t} fontSize={BASE} />
          </View>
          <Text style={{ fontSize: 16, fontWeight: 700 }}>{title}</Text>
        </View>

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
            <Label>{t("statement.customer")}</Label>
            <Text style={{ fontWeight: 700 }}>{customer.name}</Text>
            <PartyLines party={customer} t={t} fontSize={BASE} />
          </View>
          <View style={{ width: "42%", gap: 1 }}>
            <KeyValue label={t("statement.period")} value={periodText} fontSize={BASE} />
            <KeyValue
              label={t("statement.closing")}
              value={balanceText(t, closing)}
              fontSize={BASE}
              bold
            />
          </View>
        </View>

        <View style={{ marginTop: 10 }}>
          <Cells
            header
            values={[
              t("statement.columns.date"),
              t("statement.columns.particulars"),
              t("statement.columns.debit"),
              t("statement.columns.credit"),
              t("statement.columns.balance"),
            ]}
          />
          {broughtForward ? (
            <Cells
              values={[
                period.from ?? "",
                t("statement.broughtForward"),
                "",
                "",
                balanceText(t, broughtForward),
              ]}
            />
          ) : null}
          {rows.map((row, index) => (
            <Cells
              key={`${row.kind}-${String(index)}`}
              values={[
                row.date,
                particulars(t, row),
                row.debit,
                row.credit,
                balanceText(t, row.balance),
              ]}
            />
          ))}
          {rows.length === 0 ? (
            <Text style={{ marginTop: 4, color: MUTED }}>{t("statement.noRows")}</Text>
          ) : null}
          <Cells
            bold
            values={[
              "",
              t("statement.closing"),
              totals.debit,
              totals.credit,
              balanceText(t, closing),
            ]}
          />
        </View>

        <View wrap={false} style={{ marginTop: 12 }}>
          <Label>{t("statement.aging.title")}</Label>
          <View style={{ flexDirection: "row", borderBottomWidth: 0.5, borderColor: RULE }}>
            {agingColumns.map(([label]) => (
              <Text
                key={label}
                style={{ flex: 1, fontSize: SMALL, fontWeight: 700, textAlign: "right" }}
              >
                {label}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: "row", paddingTop: 2 }}>
            {agingColumns.map(([label, value]) => (
              <Text key={label} style={{ flex: 1, textAlign: "right" }}>
                {value}
              </Text>
            ))}
          </View>
        </View>

        {payment ? (
          <View
            wrap={false}
            style={{
              flexDirection: "row",
              gap: 8,
              marginTop: 12,
              paddingTop: 8,
              borderTopWidth: 0.5,
              borderColor: RULE,
            }}
          >
            <UpiQr link={payment.upiLink} size={84} />
            <View style={{ flex: 1, gap: 2 }}>
              <Label>{t("payTitle")}</Label>
              <Text>{t("scanToPay", { amount: payment.amount })}</Text>
              <Text>{t("upiId", { vpa: payment.vpa })}</Text>
            </View>
          </View>
        ) : null}

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

/** The statement as PDF bytes, on demand (ADR 0008: nothing is stored). */
export async function renderStatement(props: StatementPdfProps): Promise<Uint8Array<ArrayBuffer>> {
  registerPdfFonts();
  return new Uint8Array(await renderToBuffer(<StatementA4 {...props} />));
}
