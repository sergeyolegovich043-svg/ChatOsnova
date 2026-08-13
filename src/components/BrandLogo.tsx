type BrandLogoProps = {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
};

export function BrandLogo({ className = "", size = "md" }: BrandLogoProps) {
  return (
    <span className={`brand-logo brand-logo-${size} ${className}`.trim()} aria-hidden="true">
      <img src="/icon-512.png" alt="" />
      <span className="brand-logo-shine" />
    </span>
  );
}
