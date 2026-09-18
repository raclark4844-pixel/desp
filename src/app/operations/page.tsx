import type { Metadata } from "next";
import Operations from "./operations";
export const metadata: Metadata = {
  title: "Operations",
  robots: { index: false, follow: false },
};
export default function OperationsPage() {
  return <Operations />;
}
