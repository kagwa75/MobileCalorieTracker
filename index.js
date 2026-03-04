// Guard for libraries that accidentally touch browser globals on native.
if (typeof globalThis.document === "undefined") {
  let scriptSrc = "http://localhost/index.bundle?platform=android";
  try {
    const currentHref = typeof globalThis.location?.href === "string" ? globalThis.location.href : "";
    const url = new URL(currentHref || "http://localhost/");
    const platform = url.searchParams.get("platform") || "android";
    url.pathname = "/index.bundle";
    url.searchParams.set("platform", platform);
    scriptSrc = url.toString();
  } catch {
    // Keep safe fallback.
  }

  const mockDocument = {
    title: "",
    currentScript: { src: scriptSrc },
    head: null,
    querySelector: () => null,
    createElement: () => ({
      setAttribute: () => {},
      appendChild: () => {},
      removeChild: () => {},
      getAttribute: () => null,
      styleSheet: null,
      innerHTML: "",
      isEqualNode: () => false,
      parentNode: null,
    }),
    createTextNode: () => ({}),
    getElementsByTagName: () => [],
  };

  globalThis.document = mockDocument;

  if (typeof globalThis.window !== "undefined" && !globalThis.window.document) {
    globalThis.window.document = mockDocument;
  }
}

import "expo-router/entry";
