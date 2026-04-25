interface Env {
  HUB: DurableObjectNamespace<import("./src/index").XoxiangHub>;
  DAEMON_API_KEY: string;
  WEB_AUTH_TOKEN: string;
  XOXIANG_VERSION?: string;
  XOXIANG_COMMIT_SHA?: string;
  XOXIANG_BUILD_ID?: string;
}
