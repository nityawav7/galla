import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE } from "./config";

// No locale in the URL. Every page is English until the business language setting (F10)
// chooses per business; hi.json is kept complete alongside en.json until then.
export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  const messages = (await import(`../../messages/${locale}.json`)) as {
    default: IntlMessages;
  };
  return { locale, messages: messages.default };
});
