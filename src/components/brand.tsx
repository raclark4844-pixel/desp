import Image from "next/image";

export function Brand() {
  return (
    <div className="company-branding">
      <div className="ap-spartan-brand">
        <Image src="/ap-spartan-logo.jpg" alt="AP Spartan logo" width={784} height={1168} className="ap-spartan-logo" priority />
        <div><strong>AP Spartan</strong><span>Lead Engine</span></div>
      </div>
      <div className="demore-brand">
        <Image src="/demore-technology-solutions-logo.png" alt="Demore Technology Solutions logo" width={1913} height={822} className="demore-logo" priority sizes="(max-width: 600px) 55vw, 320px" />
        <p>Powered by <strong>Demore Technology Solutions</strong></p>
      </div>
    </div>
  );
}
