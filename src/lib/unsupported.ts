// Detects emulator error signatures for operations that a given local AWS
// emulator does not implement (unknown / unsupported / not-yet-implemented /
// pro-only). Shared across services so each page can show an "unsupported"
// notice instead of a generic error banner.
export const isUnsupportedOperation = (err: { message: string }): boolean =>
  /unknown ?operation|unknown ?service|not supported|not yet implemented|pro feature|is not valid/i.test(
    err.message,
  );
