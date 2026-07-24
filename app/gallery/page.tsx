import { redirect } from "next/navigation";

/** Gallery (shared-world picker) retired — share links still work via /s/[code]. */
export default function GalleryPage() {
  redirect("/");
}
