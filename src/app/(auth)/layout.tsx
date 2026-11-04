import Link from "next/link";

import { APP_NAME } from "@/lib/config";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        {APP_NAME}
      </Link>
      {children}
    </main>
  );
}
