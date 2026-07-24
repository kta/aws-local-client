// Detects emulator error signatures for operations that a given local AWS
// emulator does not implement (unknown / unsupported / not-yet-implemented /
// pro-only). Shared across services so each page can show an "unsupported"
// notice instead of a generic error banner.
//
// The wordings observed across the four probed emulators:
//   - ministack / floci: "UnknownOperationException", "The action X is not valid",
//     "InvalidAction".
//   - localstack:3 (Pro gate): "…is either not included in your current license
//     plan or has not yet been emulated" ("license plan" / "not yet emulated").
//   - kumo: unrouted services answer a plain HTTP 404 whose body is
//     "404 page not found" (surfaced verbatim by the Rust error layer), and
//     "UnknownService" for services it does not model at all.
export const isUnsupportedOperation = (err: { message: string }): boolean =>
  /unknown ?operation|unknown ?service|invalid ?action|not supported|not yet (implemented|emulated)|pro feature|license plan|is not valid|page not found/i.test(
    err.message,
  );
