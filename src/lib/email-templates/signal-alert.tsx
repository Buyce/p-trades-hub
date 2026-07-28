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

/**
 * Alert email for a qualified A / A+ setup. Renders only values produced by the
 * scanner — nothing here is calculated or inferred at render time.
 */

export interface SignalAlertEmailProps {
  siteName: string;
  signalUrl: string;
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
}: SignalAlertEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {instrument} {direction} — {grade} setup, {rrTp1} to TP1
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {instrument} {direction} — {grade}
        </Heading>
        <Text style={text}>
          A qualified setup passed every rulebook gate. {siteName} does not place trades — you
          decide and execute manually.
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
        <Line label="Grade" value={grade} />

        <Hr style={{ borderColor: "#e3e8ee", margin: "22px 0" }} />

        <Text style={{ ...text, margin: "0 0 10px", fontWeight: 600, color: "#0f1720" }}>
          Why it qualified
        </Text>
        {reasons.map((reason, i) => (
          <Text key={i} style={{ ...text, margin: "0 0 8px" }}>
            • {reason}
          </Text>
        ))}

        <Button style={{ ...button, marginTop: "18px" }} href={signalUrl}>
          Open signal detail
        </Button>

        <Text style={fallbackText}>If the button does not open, use this link:</Text>
        <Text style={urlBlock}>{signalUrl}</Text>

        <Text style={footer}>
          You are receiving this because email alerts are switched on in your {siteName} settings.
          Turn them off any time under Settings → Alerts.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default SignalAlertEmail;
