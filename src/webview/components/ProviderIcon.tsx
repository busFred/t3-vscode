import type { ProviderBrand } from "../../shared/usage";
import { providerIcons } from "../../shared/providerIcons";
export function ProviderIcon({ brand }: { readonly brand: ProviderBrand }) {
  const icon = providerIcons[brand];
  return <svg className="provider-icon" viewBox={icon.viewBox} fill="currentColor" aria-hidden="true"><path d={icon.path} fillRule="evenodd" /></svg>;
}
