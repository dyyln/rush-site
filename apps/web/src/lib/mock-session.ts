// Mock sign in state, kept per browser. Signed in unless the viewer signed out
const KEY = "rushsite-mock-signed-in";

export function mockSignedIn(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setMockSignedIn(v: boolean) {
  try {
    window.localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    // Storage can be blocked. The mock then stays signed in
  }
}
