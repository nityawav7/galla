/**
 * The one sentence the last-resort error page shows (src/app/global-error.tsx). That page loads
 * with every page and has no translations provider, so it can't import the message files
 * (about 120 KB). A test keeps these equal to `errors.generic` in both of them.
 */
export const FATAL_ERROR_MESSAGE = {
  en: "Something went wrong. Please try again.",
  hi: "कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।",
} as const;
