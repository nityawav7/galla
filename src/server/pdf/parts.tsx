import { Path, Svg, Text, View } from "@react-pdf/renderer";

import { qrPath } from "@/lib/qr";
import { type PrintableParty } from "@/server/domain/invoice/printable";

import { type DocumentPdfProps, type PdfTranslator } from "./types";

/* Pieces both layouts share. Colours are print-safe greys; no element relies on colour alone. */

export const INK = "#111827";
export const MUTED = "#4b5563";
export const RULE = "#9ca3af";

export function documentTitle({ doc, creditNote, t }: DocumentPdfProps): string {
  return creditNote ? t("title.CREDIT_NOTE") : t(`title.${doc.type}`);
}

export function PartyLines({
  party,
  t,
  fontSize,
}: {
  party: PrintableParty;
  t: PdfTranslator;
  fontSize: number;
}) {
  return (
    <>
      {party.legalName ? <Text style={{ fontSize }}>{party.legalName}</Text> : null}
      {party.address.map((line) => (
        <Text key={line} style={{ fontSize }}>
          {line}
        </Text>
      ))}
      {party.gstin ? <Text style={{ fontSize }}>{t("gstin", { gstin: party.gstin })}</Text> : null}
      {party.phone ? <Text style={{ fontSize }}>{t("phone", { phone: party.phone })}</Text> : null}
    </>
  );
}

/** The UPI QR as vector squares; `size` is the printed width in points. */
export function UpiQr({ link, size }: { link: string; size: number }) {
  const qr = qrPath(link);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${String(qr.size)} ${String(qr.size)}`}>
      <Path d={qr.d} fill="#000000" />
    </Svg>
  );
}

/** "CANCELLED" across the top of a cancelled document. */
export function CancelledStamp({ t, fontSize }: { t: PdfTranslator; fontSize: number }) {
  return <Stamp label={t("cancelled")} fontSize={fontSize} />;
}

/** "SAMPLE — demo data, not a real bill" on the demo shop's documents (SPEC F12). */
export function SampleStamp({ t, fontSize }: { t: PdfTranslator; fontSize: number }) {
  return <Stamp label={t("sample")} fontSize={fontSize} />;
}

function Stamp({ label, fontSize }: { label: string; fontSize: number }) {
  return (
    <Text
      style={{
        fontSize,
        fontWeight: 700,
        color: "#b91c1c",
        borderWidth: 1.5,
        borderColor: "#b91c1c",
        paddingHorizontal: 6,
        paddingVertical: 2,
        alignSelf: "flex-start",
      }}
    >
      {label}
    </Text>
  );
}

export function KeyValue({
  label,
  value,
  fontSize,
  bold = false,
}: {
  label: string;
  value: string;
  fontSize: number;
  bold?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ fontSize, color: bold ? INK : MUTED, fontWeight: bold ? 700 : 400 }}>
        {label}
      </Text>
      <Text style={{ fontSize, fontWeight: bold ? 700 : 400, textAlign: "right" }}>{value}</Text>
    </View>
  );
}
