import Terminal from "@/components/Terminal";

export const dynamic = "force-dynamic";

export default async function SeedPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <Terminal seedCode={code} />;
}
