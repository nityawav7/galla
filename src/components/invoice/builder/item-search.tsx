"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { searchProductsAction } from "@/app/(app)/b/[businessSlug]/invoices/actions";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { type ProductOption } from "@/lib/invoice-options";
import { formatINR, parseRupees } from "@/server/domain/money";

import { useSearch } from "./use-search";

interface ItemSearchProps {
  businessSlug: string;
  onAddProduct: (product: ProductOption) => void;
  onAddOneOff: (description: string) => void;
  disabled?: boolean;
}

function priceLabel(price: string): string {
  try {
    return formatINR(parseRupees(price));
  } catch {
    return price;
  }
}

/** "Add item": search the products, or type a one-off item that isn't in the list. */
export function ItemSearch({ businessSlug, onAddProduct, onAddOneOff, disabled }: ItemSearchProps) {
  const t = useTranslations("invoices.builder");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useCallback((q: string) => searchProductsAction(businessSlug, q), [businessSlug]);
  const { results, loading, failed } = useSearch(open, query, search);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled={disabled}
        aria-expanded={open}
        aria-controls="item-search-panel"
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        {open ? t("closeItemSearch") : t("addItem")}
      </Button>
      {open ? (
        <div id="item-search-panel" className="flex flex-col gap-2 rounded-lg border p-3">
          <TextField
            label={t("searchProducts")}
            type="search"
            autoFocus
            autoComplete="off"
            placeholder={t("searchProductsPlaceholder")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter adds the best match, so a keyboard user can type and press Enter.
              if (event.key !== "Enter") return;
              event.preventDefault();
              const first = results[0];
              if (first) {
                onAddProduct(first);
                close();
              } else if (query.trim()) {
                onAddOneOff(query.trim());
                close();
              }
            }}
          />
          <div aria-live="polite" className="text-sm text-muted-foreground">
            {loading ? t("searching") : failed ? t("searchFailed") : null}
            {!loading && !failed && results.length === 0 ? t("noProducts") : null}
          </div>
          <ul className="flex flex-col divide-y">
            {results.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => {
                    onAddProduct(product);
                    close();
                  }}
                >
                  <span className="font-medium">{product.name}</span>
                  <span className="text-sm whitespace-nowrap text-muted-foreground">
                    {priceLabel(product.price)} / {product.unit}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => {
              onAddOneOff(query.trim());
              close();
            }}
          >
            {query.trim() ? t("addOneOffNamed", { name: query.trim() }) : t("addOneOff")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
