import { redirect } from "next/navigation";

export default function NewWfhPage(): never {
  redirect("/wfh?new=1");
}
