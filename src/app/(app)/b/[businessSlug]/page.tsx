import { redirect } from "next/navigation";

export default async function BusinessHome({ params }: PageProps<"/b/[businessSlug]">) {
  const { businessSlug } = await params;
  redirect(`/b/${businessSlug}/dashboard`);
}
