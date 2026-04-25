export const APP_VERSION = '0.6.0';

export type ComponentName = 'shared' | 'hub-core' | 'server' | 'cloudflare-hub' | 'web' | 'daemon';

export type VersionInfo = {
  component: ComponentName;
  version: string;
  commit?: string;
  build?: string;
};

export function createVersionInfo(
  component: ComponentName,
  opts: { version?: string; commit?: string; build?: string } = {},
): VersionInfo {
  return {
    component,
    version: opts.version?.trim() || APP_VERSION,
    commit: opts.commit?.trim() || undefined,
    build: opts.build?.trim() || undefined,
  };
}
