/// <reference types="vite/client" />

// 0874: pricing-page override for the demo (local Stripe checkout).
interface ImportMetaEnv {
  readonly VITE_PRICING_URL?: string;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.svg?react" {
  import * as React from "react";
  const Component: React.FC<React.SVGProps<SVGSVGElement>>;
  export default Component;
}
