import { Brand } from "@/components/brand";
import { EmployeeSignIn } from "@/components/employee-sign-in";
export const metadata = { title: "Employee sign-in" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>;
}) {
  const { changed } = await searchParams;
  return (
    <main className="page-shell">
      <Brand />
      <h1>Employee sign-in</h1>
      <p>Welcome to the AP Spartan private workspace.</p>
      {changed === "1" && (
        <p className="notice success">
          Password updated. Sign in with your new password.
        </p>
      )}
      <EmployeeSignIn />
    </main>
  );
}
