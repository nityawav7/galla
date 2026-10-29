import { APP_NAME, APP_TAGLINE } from "@/lib/config";

// Placeholder until the landing page in Phase 12.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-medium text-muted-foreground">Coming soon</p>
      <h1 className="text-4xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-lg text-muted-foreground">
        {APP_TAGLINE}. Make a GST-correct invoice in under a minute, share it on WhatsApp with a UPI
        QR, and hand your CA a clean export.
      </p>
      <p className="text-xs text-muted-foreground">Not tax or legal advice.</p>
    </main>
  );
}
