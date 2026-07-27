import type { CapacitorConfig } from "@capacitor/cli";

const mobileServerUrl =
  process.env.CAPACITOR_SERVER_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "http://172.20.10.13:3000";
const mobileServerUsesCleartext = mobileServerUrl.startsWith("http://");

const config: CapacitorConfig = {
  appId: "com.zerinix.app",
  appName: "ZERINIX",
  webDir: "capacitor-web",
  server: mobileServerUrl
    ? {
        url: mobileServerUrl,
        cleartext: mobileServerUsesCleartext,
      }
    : undefined,
  ios: {
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: mobileServerUsesCleartext,
  },
};

export default config;
