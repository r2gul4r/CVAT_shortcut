/* Metadata simulation only. This is still Windows Chrome, not a Mac device test. */
Object.defineProperty(navigator, "platform", {configurable: true, value: "MacIntel"});
Object.defineProperty(navigator, "userAgentData", {configurable: true, value: {platform: "macOS"}});
