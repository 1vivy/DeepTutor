/** @deprecated Import the canonical capability feature directly. */
import { fetchCapabilityCatalog } from "@/features/capabilities/api";

export { useCapabilityFilter } from "@/features/capabilities/useCapabilityCatalog";
export type { CapabilityFilter } from "@/features/capabilities/useCapabilityCatalog";

export async function listRegisteredCapabilities(): Promise<string[]> {
  return (await fetchCapabilityCatalog()).map((capability) => capability.id);
}
