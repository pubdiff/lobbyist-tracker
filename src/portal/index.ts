// Shared Microsoft Power Apps / Dynamics portal toolkit.
//
// Used by the QLD and WA adapters, which are both Power Apps portals (the same
// platform as the sibling epbc-tracker). This is the copy-first local module;
// when @pubdiff/core is eventually stood up, this is the thing to lift and have
// both trackers consume. See types.ts for the why.

export * from "./types.ts";
export * from "./browser.ts";
export * from "./session.ts";
export * from "./grid.ts";
export * from "./attrs.ts";
