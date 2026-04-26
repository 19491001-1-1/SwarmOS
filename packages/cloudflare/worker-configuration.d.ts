interface Env {
  HUB: DurableObjectNamespace<import("./src/index").CrewdenHub>;
  DAEMON_API_KEY: string;
  WEB_AUTH_TOKEN: string;
  CREWDEN_VERSION?: string;
  CREWDEN_COMMIT_SHA?: string;
  CREWDEN_BUILD_ID?: string;
}
