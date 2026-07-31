import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Column,
  Text,
} from "@react-email/components";
import { main, container, h1, text, button, footer, urlBlock, fallbackText } from "./styles";
import { tierCopy } from "./tier-alert-copy";
import type { Tier } from "@/lib/ptrades/tiers";

/**
 * Alert email for a qualified setup. Subject and body copy are chosen by the
 * tier stored on the signal, so B and C alerts read differently from A / A+.
 * Renders only values produced by the scanner — nothing here is calculated,
 * inferred or upgraded at render time.
 */

export interface SignalAlertEmailProps {
  siteName: string;
  signalUrl: string;
  /** Delivery test — renders a clear, non-actionable test notice. */
  test?: boolean;
  /** Stored tier code. Null renders neutral, unlabelled copy. */
  tier: Tier | null;
  instrument: string;
  direction: string;
  grade: string;
  setupType: string;
  timeframe: string;
  entryZone: string;
  stopLoss: string;
  targets: string[];
  rrTp1: string;
  score: string;
  reasons: string[];
}

const labelCol = {
  fontSize: "12px",
  color: "#647384",
  padding: "6px 0",
  width: "44%",
} as const;

const valueCol = {
  fontFamily: `"IBM Plex Mono", ui-monospace, monospace`,
  fontSize: "13px",
  color: "#0f1720",
  padding: "6px 0",
  textAlign: "right" as const,
};

function Line({ label, value }: { label: string; value: string }) {
  return (
    <Row>
      <Column style={labelCol}>{label}</Column>
      <Column style={valueCol}>{value}</Column>
    </Row>
  );
}

export const SignalAlertEmail = ({
  siteName,
  signalUrl,
  test,
  tier,
  instrument,
  direction,
  grade,
  setupType,
  timeframe,
  entryZone,
  stopLoss,
  targets,
  rrTp1,
  score,
  reasons,
}: SignalAlertEmailProps) => {
  const copy = tierCopy(tier);
  return (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Tier {grade} · {instrument} {direction} — {rrTp1} to TP1
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Text
          style={{
            display: "inline-block",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: copy.accent,
            backgroundColor: copy.accentBg,
            border: `1px solid ${copy.accentBorder}`,
            borderRadius: "4px",
            padding: "5px 10px",
            margin: "0 0 14px",
          }}
        >
          {copy.banner}
        </Text>
        <Heading style={h1}>
          {instrument} {direction} — Tier {grade}
        </Heading>
        <Text style={text}>
          {copy.intro} {siteName} does not place trades — you decide and execute manually.
        </Text>

        <Line label="Direction" value={direction} />
        <Line label="Setup" value={setupType} />
        <Line label="Timeframe" value={timeframe} />
        <Line label="Entry zone" value={entryZone} />
        <Line label="Stop-loss" value={stopLoss} />
        {targets.map((t, i) => (
          <Line key={t + i} label={`Target ${i + 1}`} value={t} />
        ))}
        <Line label="R:R at TP1" value={rrTp1} />
        <Line label="Confidence score" value={score} />
        <Line label="Tier" value={grade} />

        <Hr style={{ borderColor: "#e3e8ee", margin: "22px 0" }} />

        <Text style={{ ...text, margin: "0 0 10px", fontWeight: 600, color: "#0f1720" }}>
          Why it qualified
        </Text>
        {reasons.map((reason, i) => (
          <Text key={i} style={{ ...text, margin: "0 0 8px" }}>
            • {reason}
          </Text>
        ))}

        <Text
          style={{
            ...text,
            margin: "18px 0 0",
            padding: "12px 14px",
            fontSize: "13px",
            color: copy.accent,
            backgroundColor: copy.accentBg,
            border: `1px solid ${copy.accentBorder}`,
            borderRadius: "6px",
          }}
        >
          {copy.note}
        </Text>

        <Button style={{ ...button, marginTop: "18px" }} href={signalUrl}>
          Open signal detail
        </Button>

        <Text style={fallbackText}>If the button does not open, use this link:</Text>
        <Text style={urlBlock}>{signalUrl}</Text>

        <Text style={footer}>
          You are receiving this because Tier {grade} email alerts are switched on in your{" "}
          {siteName} settings. Change which tiers reach your inbox any time under Settings → Alerts.
        </Text>
      </Container>
    </Body>
  </Html>
  );
};

export default SignalAlertEmail;
