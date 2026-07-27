/** Shared P-Trades email styles. Body background stays white for inbox safety. */
const FONT_SANS = `"IBM Plex Sans", -apple-system, "Segoe UI", Arial, sans-serif`;
const FONT_MONO = `"IBM Plex Mono", ui-monospace, "SFMono-Regular", monospace`;

export const main = {
  backgroundColor: "#ffffff",
  fontFamily: FONT_SANS,
  padding: "24px 0",
};
export const container = {
  maxWidth: "520px",
  padding: "32px",
  border: "1px solid #e3e8ee",
  borderRadius: "10px",
  backgroundColor: "#ffffff",
};
export const h1 = {
  fontSize: "20px",
  fontWeight: 600 as const,
  letterSpacing: "-0.01em",
  color: "#0f1720",
  margin: "0 0 18px",
};
export const text = {
  fontSize: "14px",
  color: "#4a5563",
  lineHeight: "1.6",
  margin: "0 0 22px",
};
export const link = { color: "#155e75", textDecoration: "underline" };
export const button = {
  backgroundColor: "#0f1720",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600 as const,
  borderRadius: "8px",
  padding: "12px 22px",
  textDecoration: "none",
  display: "inline-block",
};
export const footer = {
  fontSize: "12px",
  color: "#8a94a3",
  lineHeight: "1.6",
  borderTop: "1px solid #e3e8ee",
  paddingTop: "16px",
  margin: "32px 0 0",
};
export const codeStyle = {
  fontFamily: FONT_MONO,
  fontSize: "26px",
  fontWeight: 600 as const,
  letterSpacing: "0.18em",
  color: "#0f1720",
  backgroundColor: "#f4f6f9",
  border: "1px solid #e3e8ee",
  borderRadius: "8px",
  padding: "14px 18px",
  display: "inline-block",
  margin: "0 0 26px",
};
