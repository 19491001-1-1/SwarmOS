interface Env {
  HUB: DurableObjectNamespace<import("./src/index").XoxiangHub>;
  DAEMON_API_KEY: string;
}
