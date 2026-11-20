import { describe, expect, it } from "vitest";
import { assertProdServerUrl } from "../src/net/buildGuard";

describe("assertProdServerUrl (M1)", () => {
  it("fails a prod build with an empty or missing server url", () => {
    expect(() => assertProdServerUrl({ VITE_APP_ENV: "prod" })).toThrow(/VITE_SERVER_URL/);
    expect(() => assertProdServerUrl({ VITE_APP_ENV: "prod", VITE_SERVER_URL: "  " })).toThrow(/VITE_SERVER_URL/);
  });
  it("passes prod with a url and non-prod without", () => {
    expect(() => assertProdServerUrl({ VITE_APP_ENV: "prod", VITE_SERVER_URL: "https://x.workers.dev" })).not.toThrow();
    expect(() => assertProdServerUrl({ VITE_APP_ENV: "prod", VITE_SERVER_URL: "self" })).not.toThrow();
    expect(() => assertProdServerUrl({})).not.toThrow();
    expect(() => assertProdServerUrl({ VITE_APP_ENV: "staging" })).not.toThrow();
  });
});
