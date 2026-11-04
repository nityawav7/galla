import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { type Product } from "@/server/db/repos/products.repo";
import { formatINR } from "@/server/domain/money";
import { formatRatePercent } from "@/server/domain/tax-rate";

interface ProductListProps {
  businessSlug: string;
  products: Product[];
}

/** Cards on phones (SPEC §6.1, 360 px), a table from `md` up. Server-rendered. */
export async function ProductList({ businessSlug, products }: ProductListProps) {
  const t = await getTranslations("products");
  const href = (product: Product) => `/b/${businessSlug}/products/${product.id}`;
  const priceNote = (product: Product) =>
    product.priceIncludesTax ? t("inclusive") : t("exclusive");

  return (
    <>
      <ul className="flex flex-col divide-y rounded-lg border md:hidden">
        {products.map((product) => (
          <li key={product.id}>
            <Link
              href={href(product)}
              className="flex flex-col gap-0.5 p-3 focus-visible:bg-muted focus-visible:outline-none"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{product.name}</span>
                <span className="shrink-0 tabular-nums">{formatINR(product.pricePaise)}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {product.unit} · {t("columns.rate")} {formatRatePercent(product.rateBp)}{" "}
                {priceNote(product)}
                {product.hsnSac ? ` · HSN ${product.hsnSac}` : ""}
                {product.sku ? ` · ${product.sku}` : ""}
                {product.archivedAt ? ` · ${t("archived")}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              {t("columns.name")}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {t("columns.hsnSac")}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {t("columns.unit")}
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              {t("columns.price")}
            </th>
            <th scope="col" className="py-2 font-medium">
              {t("columns.rate")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {products.map((product) => (
            <tr key={product.id}>
              <td className="py-2 pr-3">
                <Link
                  href={href(product)}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {product.name}
                </Link>
                {product.sku ? (
                  <span className="ml-2 text-xs text-muted-foreground">{product.sku}</span>
                ) : null}
              </td>
              <td className="py-2 pr-3 tabular-nums">{product.hsnSac ?? "—"}</td>
              <td className="py-2 pr-3">{product.unit}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatINR(product.pricePaise)}</td>
              <td className="py-2">
                {formatRatePercent(product.rateBp)}{" "}
                <span className="text-xs text-muted-foreground">{priceNote(product)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
