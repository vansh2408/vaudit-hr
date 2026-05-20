import { redirect } from "next/navigation";

/**
 * /leave/new — redirects to /leave?new=1 so the list page can pop the
 * same dialog without duplicating the form's data dependencies. Keeps
 * the URL bookmarkable for users sharing a "submit time off" link.
 */
export default function NewLeavePage(): never {
  redirect("/leave?new=1");
}
