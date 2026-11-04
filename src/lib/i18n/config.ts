/** Languages with a message file in src/messages. Business-level choice arrives with settings. */
export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
