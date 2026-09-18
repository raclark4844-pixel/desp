import Image from "next/image";

export function Brand() {
  return (
    <div className="ap-spartan-brand">
      <Image src="/ap-spartan-logo.jpg" alt="AP Spartan logo" width={784} height={1168} className="ap-spartan-logo" priority />
      <div><strong>AP Spartan</strong><span>Lead Engine</span></div>
    </div>
  );
}
