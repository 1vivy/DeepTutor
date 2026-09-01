import SettingsMain from "@/components/settings/SettingsMain";
import {
  ModelCatalogProvider,
  SettingsDraftProvider,
  SettingsProvider,
  UiSettingsProvider,
} from "@/features/settings/store";
import { SettingsTourOverlay } from "@/components/settings/SettingsTourOverlay";

export default function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SettingsProvider>
      <UiSettingsProvider>
        <ModelCatalogProvider>
          <SettingsDraftProvider>
            <SettingsMain>{children}</SettingsMain>
            {/* Mounted once at the layout level so the cross-route guided tour
                survives navigation between the hub and its sub-pages. */}
            <SettingsTourOverlay />
          </SettingsDraftProvider>
        </ModelCatalogProvider>
      </UiSettingsProvider>
    </SettingsProvider>
  );
}
